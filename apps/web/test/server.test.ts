import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fallbackProvider } from "@pb/ai";
import { createSocketServer, type SocketServerOptions } from "../server/socket-server";
import { connectBot, expectOk, playBots, type BotSocket } from "../scripts/bots";
import { ReplayStore } from "../server/replay";
import { GameRoom } from "../server/room";
import { getScenario } from "@pb/scenarios";
import { createGame, type CandidateProfile, type PendingYear } from "@pb/sim";
import { publicCandidate, publicRecap } from "../server/public-state";

const shutdown: (() => Promise<void>)[] = [];
const clients: BotSocket[] = [];
afterEach(async () => { for (const client of clients.splice(0)) client.disconnect(); for (const close of shutdown.splice(0)) await close(); });

async function setup(options: SocketServerOptions = {}) {
  const directory = await mkdtemp(join(tmpdir(), "pb-server-test-"));
  const httpServer = createServer();
  const server = createSocketServer(httpServer, { provider: fallbackProvider, replayDirectory: directory, timingOverride: { startPrompt: 50, turn: 50, recap: 1, election: 1 }, ...options });
  await new Promise<void>((ready) => httpServer.listen(0, "127.0.0.1", ready));
  const address = httpServer.address();
  if (!address || typeof address === "string") throw new Error("Missing server address");
  shutdown.push(async () => { await server.close(); await rm(directory, { recursive: true, force: true }); });
  const url = `http://127.0.0.1:${address.port}`;
  const connect = async () => { const socket = await connectBot(url); clients.push(socket); return socket; };
  return { server, url, directory, connect };
}

describe("authoritative socket server", () => {
  it("plays four turns, publishes pending recaps, and replays without model calls", async () => {
    let providerCalls = 0;
    const { url, directory } = await setup({ provider: { run: (...args) => { providerCalls++; return fallbackProvider.run(...args); } } });
    const game = await playBots(url, { timeoutMs: 10000 });
    expect(game.final.phase).toBe("end");
    expect(game.final.year).toBe(4);
    expect(game.final.recaps).toHaveLength(5);
    expect(game.snapshots.some((state) => state.recap?.pending && !state.recap.poll)).toBe(true);
    expect(game.snapshots.filter((state) => state.phase === "turn").map((state) => state.year)).toEqual(expect.arrayContaining([1, 2, 3, 4]));
    const log = await new ReplayStore(directory).load(game.final.gameId);
    expect(log.prompts.size).toBe(10);
    expect(log.outputs.size).toBeGreaterThan(10);
    const originalCalls = providerCalls;
    const replay = await playBots(url, { replay: game.final.gameId, timeoutMs: 10000 });
    expect(providerCalls).toBe(originalCalls);
    expect(replay.final.election).toEqual(game.final.election);
    expect(replay.final.recaps).toEqual(game.final.recaps);
  });

  it("validates payloads, host authority, two seats, and stale submissions", async () => {
    const { connect } = await setup({ timingOverride: { startPrompt: 1000 } });
    const first = await connect(); const second = await connect(); const third = await connect();
    expect(await first.emitWithAck("createRoom", { nickname: " " })).toMatchObject({ ok: false, error: { code: "INVALID_PAYLOAD" } });
    expect(await first.emitWithAck("createRoom", { nickname: "Host", scenarioId: "unknown" })).toMatchObject({ ok: false, error: { code: "INVALID_PAYLOAD" } });
    const host = expectOk(await first.emitWithAck("createRoom", { nickname: "Host" }));
    expect(await first.emitWithAck("startGame", {})).toMatchObject({ ok: false });
    expectOk(await second.emitWithAck("joinRoom", { code: host.code, nickname: "Guest" }));
    expect(await third.emitWithAck("joinRoom", { code: host.code, nickname: "Third" })).toMatchObject({ ok: false, error: { code: "ROOM_FULL" } });
    expect(await second.emitWithAck("startGame", {})).toMatchObject({ ok: false, error: { code: "UNAUTHORIZED" } });
    expectOk(await first.emitWithAck("startGame", {}));
    expect(await first.emitWithAck("submitPrompt", { phase: "turn", year: 1, prompt: "too early" })).toMatchObject({ ok: false, error: { code: "WRONG_PHASE" } });
    expectOk(await first.emitWithAck("submitPrompt", { phase: "startPrompt", year: 0, prompt: "A reformer" }));
    expect(await first.emitWithAck("submitPrompt", { phase: "startPrompt", year: 0, prompt: "again" })).toMatchObject({ ok: false, error: { code: "ALREADY_SUBMITTED" } });
  });

  it("reconnects with a private token and revokes the replaced socket", async () => {
    const { connect } = await setup();
    const original = await connect(); const replacement = await connect(); const stranger = await connect();
    const session = expectOk(await original.emitWithAck("createRoom", { nickname: "Host" }));
    const guest = await connect();
    const guestSession = expectOk(await guest.emitWithAck("joinRoom", { code: session.code, nickname: "Guest" }));
    expect(await original.emitWithAck("reconnectRoom", { code: session.code, token: guestSession.token })).toMatchObject({ ok: false, error: { code: "UNAUTHORIZED" } });
    expect(JSON.stringify(session.state)).not.toContain(session.token);
    expect(await stranger.emitWithAck("reconnectRoom", { code: session.code, token: "f".repeat(64) })).toMatchObject({ ok: false, error: { code: "UNAUTHORIZED" } });
    const reconnected = expectOk(await replacement.emitWithAck("reconnectRoom", { code: session.code, token: session.token }));
    expect(reconnected.side).toBe("a");
    expect(await original.emitWithAck("startGame", {})).toMatchObject({ ok: false, error: { code: "UNAUTHORIZED" } });
    const revisions: number[] = [];
    original.on("roomState", (state) => revisions.push(state.revision));
    expectOk(await replacement.emitWithAck("startGame", {}));
    expect(revisions).toEqual([]);
    original.disconnect();
    expect(reconnected.state.players[0]?.connected).toBe(true);
  });

  it("auto-submits empty prompts on every deadline and completes without active players", async () => {
    const { connect, server, directory } = await setup({ timingOverride: { startPrompt: 5, turn: 5, recap: 1, election: 1 } });
    const first = await connect(); const second = await connect();
    const host = expectOk(await first.emitWithAck("createRoom", { nickname: "Host" }));
    expectOk(await second.emitWithAck("joinRoom", { code: host.code, nickname: "Guest" }));
    expectOk(await first.emitWithAck("startGame", {}));
    first.disconnect(); second.disconnect();
    const room = server.rooms.get(host.code)!;
    await new Promise<void>((resolve, reject) => {
      const stop = Date.now() + 5000;
      const check = () => { if (room.phase === "end") resolve(); else if (Date.now() > stop) reject(new Error("Deadline progression stalled")); else setTimeout(check, 5); };
      check();
    });
    expect(room.snapshot("a").election).not.toBeNull();
    const replay = await new ReplayStore(directory).load(host.gameId);
    expect([...replay.prompts.values()]).toEqual(Array.from({ length: 10 }, () => ""));
  });

  it("bounds room capacity and cleans abandoned rooms", async () => {
    const { connect, server } = await setup({ maxRooms: 1, abandonedMs: 0 });
    const first = await connect(); const second = await connect();
    expectOk(await first.emitWithAck("createRoom", { nickname: "Host" }));
    expect(await second.emitWithAck("createRoom", { nickname: "Host2" })).toMatchObject({ ok: false, error: { code: "CAPACITY" } });
    first.disconnect();
    await new Promise((ready) => setTimeout(ready, 10));
    await server.cleanup();
    expect(server.rooms.size).toBe(0);
    expectOk(await second.emitWithAck("createRoom", { nickname: "Host2" }));
  });

  it("caps timers even if an override requests unbounded durations", async () => {
    const { directory } = await setup();
    const room = new GameRoom({ code: "ABCDEF", nickname: "Host", scenarioId: "uk", timing: "normal", provider: fallbackProvider, replayStore: new ReplayStore(directory), timingOverride: { startPrompt: Infinity }, emit: () => undefined });
    room.attach("a", "one"); room.join("Guest", "two");
    const before = Date.now();
    await room.start("a");
    expect(room.deadline! - before).toBeLessThanOrEqual(120100);
    room.deadline = Date.now() - 1;
    expect(() => room.submit("a", { phase: "startPrompt", year: 0, prompt: "Late" })).toThrow("deadline has passed");
    await room.close();
  });
});

describe("private state projection", () => {
  it("never exposes opponent funds, secret cases, raw summaries or dropped actions", () => {
    const profile: CandidateProfile = { name: "Test", party: "Party", ideology: "Centre", background: "worker", positions: [], charisma: 0.5, trust: 0.5, strengths: [], weaknesses: [], slogan: "Hello", bio: "Public bio" };
    const state = createGame(getScenario("uk"), "privacy", { a: { nickname: "A", profile }, b: { nickname: "B", profile } });
    const secret = { kind: "corruption" as const, issue: null, stance: null, target: "national", channel: null, intensity: 3, requestedIntensity: 3, cost: 0, description: "SECRET_DEAL", secret: true };
    const pending: PendingYear = { year: 2, final: false, startShare: 0.5, events: [], exposures: [], turns: { a: { year: 1, submitted: true, summary: "SECRET_DEAL", flipFlop: false, applied: [secret], dropped: [] }, b: null }, breakdown: [{ source: "corruption", side: "a", label: "SECRET_DEAL", delta: { a: 1, b: -1 }, secret: true }] };
    expect(JSON.stringify(publicRecap(pending, "b"))).not.toContain("SECRET_DEAL");
    expect(JSON.stringify(publicRecap(pending, "a"))).toContain("SECRET_DEAL");
    expect(publicCandidate(state.candidates.a)).not.toHaveProperty("funds");
    expect(publicCandidate(state.candidates.a)).not.toHaveProperty("history");
    expect(publicCandidate(state.candidates.a)).not.toHaveProperty("corruptionCases");
  });
});

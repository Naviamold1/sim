import { io, type Socket } from "socket.io-client";
import type { Ack, ClientToServerEvents, RoomState, ServerToClientEvents, Session } from "../shared/protocol";

export type BotSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
export function expectOk<T>(reply: Ack<T>): T { if (!reply.ok) throw new Error(`${reply.error.code}: ${reply.error.message}`); return reply.data; }
export async function connectBot(url: string): Promise<BotSocket> {
  const socket: BotSocket = io(url, { transports: ["websocket"], forceNew: true, reconnection: false, autoConnect: false });
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("connect_error", reject);
      socket.connect();
    });
  } catch (error: unknown) { socket.disconnect(); throw error; }
  return socket;
}

export interface BotGame { final: RoomState; snapshots: RoomState[]; session: Session }
export async function playBots(url: string, options: { replay?: string; seed?: string; timeoutMs?: number } = {}): Promise<BotGame> {
  const first = await connectBot(url);
  const second = await connectBot(url);
  const snapshots: RoomState[] = [];
  let rejectGame: (error: Error) => void = () => undefined;
  let resolveGame: (state: RoomState) => void = () => undefined;
  const done = new Promise<RoomState>((resolve, reject) => { resolveGame = resolve; rejectGame = reject; });
  void done.catch(() => undefined);
  const timeout = setTimeout(() => rejectGame(new Error("Two-bot game exceeded its time budget")), options.timeoutMs ?? 600000);
  const pending = new Set<string>();
  const watch = (socket: BotSocket) => socket.on("roomState", (state) => {
    if (socket === first) snapshots.push(state);
    if (state.error) { rejectGame(new Error(state.error.message)); return; }
    if (state.phase === "end" && socket === first) { resolveGame(state); return; }
    if (state.replay || (state.phase !== "startPrompt" && state.phase !== "turn")) return;
    const ownPlayer = state.players.find((player) => player.side === state.self);
    const key = `${state.self}:${state.phase}:${state.year}`;
    if (ownPlayer?.submitted || pending.has(key)) return;
    pending.add(key);
    const prompt = state.phase === "startPrompt"
      ? `${state.self === "a" ? "Alex" : "Blair"}, a working class reformer. I promise affordable housing, better hospitals, jobs and public services.`
      : state.self === "a" && state.year === 1
        ? "Take a big secret corruption kickback from a donor. COVERT_BOT_MARKER"
        : "Promise affordable housing and run a social media campaign for better public services.";
    socket.emit("submitPrompt", { phase: state.phase, year: state.year, prompt }, (reply) => {
      if (!reply.ok) rejectGame(new Error(`${reply.error.code}: ${reply.error.message}`));
    });
  });
  watch(first); watch(second);
  try {
    const session = expectOk<Session>(await first.timeout(15000).emitWithAck("createRoom", { nickname: "Alex", timing: "demo", seed: options.seed ?? "socket-smoke", replay: options.replay }));
    expectOk(await second.timeout(15000).emitWithAck("joinRoom", { code: session.code, nickname: "Blair" }));
    expectOk(await first.timeout(15000).emitWithAck("startGame", {}));
    const final = await done;
    if (!final.election || final.year !== 4) throw new Error("Game did not finish its four-year election");
    return { final, snapshots, session };
  } finally { clearTimeout(timeout); first.disconnect(); second.disconnect(); }
}

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fallbackProvider } from "@pb/ai";
import { createSocketServer, providerFromEnvironment } from "../server/socket-server";
import { ReplayStore } from "../server/replay";
import { playBots } from "./bots";

const httpModel = process.argv.includes("--http-model");
if (httpModel && (!process.env.MODEL_API_URL || !process.env.MODEL_API_TOKEN)) throw new Error("--http-model requires MODEL_API_URL and MODEL_API_TOKEN");
const replayDirectory = new ReplayStore(process.env.REPLAY_DIR).directory;
const httpServer = createServer();
const gameServer = createSocketServer(httpServer, {
  provider: httpModel ? providerFromEnvironment() : fallbackProvider,
  replayDirectory,
  timingOverride: { recap: 10, election: 10 },
});
await new Promise<void>((ready) => httpServer.listen(0, "127.0.0.1", ready));
const address = httpServer.address();
if (!address || typeof address === "string") throw new Error("Server address missing");
const start = Date.now();
try {
  const game = await playBots(`http://127.0.0.1:${address.port}`);
  const replay = await new ReplayStore(replayDirectory).load(game.final.gameId);
  const records = (await readFile(resolve(replayDirectory, `${game.final.gameId}.jsonl`), "utf8")).trim().split("\n").map((line) => JSON.parse(line) as { kind: string; record?: { source: string } });
  const modelCalls = records.filter((record) => record.kind === "ai" && record.record?.source === "model").length;
  const fallbackCalls = records.filter((record) => record.kind === "ai" && record.record?.source === "fallback").length;
  const elapsedMs = Date.now() - start;
  if (elapsedMs >= 600000) throw new Error("Game exceeded ten minutes");
  if (!game.snapshots.some((state) => state.recap?.pending)) throw new Error("No asynchronous recap was published");
  console.log(JSON.stringify({ ok: true, mode: httpModel ? "http-model" : "fallback", gameId: game.final.gameId, elapsedMs, winner: game.final.election?.winner, aiOutputs: replay.outputs.size, modelCalls, fallbackCalls, replayDirectory }));
  if (httpModel && modelCalls === 0) throw new Error("Game completed using fallback only; no successful HTTP model calls");
} finally { await gameServer.close(); }

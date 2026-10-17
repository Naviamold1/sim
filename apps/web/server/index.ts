import { createServer } from "node:http";
import { createSocketServer } from "./socket-server";

const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Invalid PORT");
const hostname = process.env.HOST ?? "0.0.0.0";
const serverOnly = process.env.SERVER_ONLY === "1";
const nextApp = serverOnly ? null : (await import("next")).default({ dev: process.env.NODE_ENV !== "production", hostname, port });
await nextApp?.prepare();
const handler = nextApp?.getRequestHandler();
const httpServer = createServer((request, response) => {
  if (request.url === "/health") { response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify({ ok: true })); return; }
  if (handler) { void handler(request, response).catch((error: unknown) => { console.error(error); if (!response.headersSent) response.writeHead(500); response.end(); }); return; }
  response.writeHead(404); response.end("Not found");
});
const gameServer = createSocketServer(httpServer, { replayDirectory: process.env.REPLAY_DIR, origins: process.env.ALLOWED_ORIGINS?.split(",").map((origin) => origin.trim()).filter(Boolean) });
httpServer.listen(port, hostname, () => console.log(`Politics Battle listening on ${hostname}:${(httpServer.address() as { port: number }).port} (${serverOnly ? "socket only" : "web + sockets"})`));
let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  const forced = setTimeout(() => process.exit(1), 10000);
  forced.unref();
  void gameServer.close().then(() => nextApp?.close()).then(() => { clearTimeout(forced); }).catch((error: unknown) => { console.error(error); process.exitCode = 1; });
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);

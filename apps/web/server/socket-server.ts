import { randomInt } from "node:crypto";
import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { createHttpModelProvider, fallbackProvider, type AiProvider } from "@pb/ai";
import { isScenarioId } from "@pb/scenarios";
import { z } from "zod";
import { createRoomSchema, joinRoomSchema, reconnectRoomSchema, startGameSchema, submitPromptSchema, type Ack, type ClientToServerEvents, type ProtocolError, type ServerToClientEvents } from "../shared/protocol";
import type { Side } from "@pb/sim";
import { GameRoom, RoomError, type RoomTiming } from "./room";
import { ReplayStore } from "./replay";

interface Binding { room: GameRoom; side: Side }
export interface SocketServerOptions {
  provider?: AiProvider;
  replayDirectory?: string;
  maxRooms?: number;
  maxConnections?: number;
  timingOverride?: Partial<RoomTiming>;
  cleanupIntervalMs?: number;
  abandonedMs?: number;
  finishedMs?: number;
  origins?: string[];
  reportError?: (error: unknown) => void;
}

export function providerFromEnvironment(): AiProvider {
  const url = process.env.MODEL_API_URL;
  const token = process.env.MODEL_API_TOKEN;
  return url && token ? createHttpModelProvider({ url, token }) : fallbackProvider;
}

export function createSocketServer(httpServer: HttpServer, options: SocketServerOptions = {}) {
  const allowedOrigins = options.origins;
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    maxHttpBufferSize: 32768,
    cors: { origin: allowedOrigins ?? false },
    allowRequest: (request, callback) => {
      const origin = request.headers.origin;
      const allowed = !origin || (allowedOrigins ? allowedOrigins.includes(origin) : safeOrigin(origin, request.headers.host));
      callback(null, allowed);
    },
  });
  const rooms = new Map<string, GameRoom>();
  const bindings = new Map<string, Binding>();
  const roomOwners = new Map<string, string>();
  const provider = options.provider ?? providerFromEnvironment();
  const replayStore = new ReplayStore(options.replayDirectory);
  const reportError = options.reportError ?? ((error: unknown) => console.error("Game server error", error));
  const maxRooms = Math.max(1, Math.min(512, options.maxRooms ?? 128));
  const maxConnections = Math.max(2, Math.min(2048, options.maxConnections ?? 256));
  let closing = false;

  const cleanup = async () => {
    const now = Date.now();
    for (const [code, room] of rooms) {
      const finished = room.phase === "end" && now - room.lastActive > (options.finishedMs ?? 10 * 60000);
      const abandoned = !room.connected && now - room.lastActive > (options.abandonedMs ?? 5 * 60000);
      const expired = now - room.createdAt > 30 * 60000;
      if (finished || abandoned || expired) {
        rooms.delete(code);
        roomOwners.delete(code);
        for (const [connectionId, binding] of bindings) if (binding.room === room) bindings.delete(connectionId);
        await room.close().catch(reportError);
      }
    }
  };
  const cleanupTimer = setInterval(() => { void cleanup().catch(reportError); }, options.cleanupIntervalMs ?? 30000);
  cleanupTimer.unref();

  io.on("connection", (socket) => {
    if (closing || io.engine.clientsCount > maxConnections) { socket.disconnect(true); return; }
    let tokens = 30;
    let replenishedAt = Date.now();
    let busy = false;
    const wrap = <Input, Output>(schema: z.ZodType<Input>, work: (payload: Input) => Output | Promise<Output>) =>
      (payload: unknown, ack?: (reply: Ack<Output>) => void) => {
        const respond = (reply: Ack<Output>) => { if (typeof ack === "function") ack(reply); else if (!reply.ok) socket.emit("error", reply.error); };
        tokens = Math.min(30, tokens + (Date.now() - replenishedAt) / 1000);
        replenishedAt = Date.now();
        if (tokens < 1) { respond({ ok: false, error: { code: "RATE_LIMIT", message: "Too many requests" } }); return; }
        tokens--;
        const parsed = schema.safeParse(payload);
        if (!parsed.success) { respond({ ok: false, error: { code: "INVALID_PAYLOAD", message: "Invalid request payload" } }); return; }
        if (busy) { respond({ ok: false, error: { code: "RATE_LIMIT", message: "Another request is in progress" } }); return; }
        busy = true;
        void Promise.resolve().then(() => {
          if (!socket.connected || closing) throw new RoomError("UNAUTHORIZED", "Connection closed");
          return work(parsed.data);
        }).then((data) => { respond({ ok: true, data }); }).catch((error: unknown) => {
          const protocolError: ProtocolError = error instanceof RoomError ? { code: error.code, message: error.message } : { code: "INTERNAL", message: "Request could not be completed" };
          if (!(error instanceof RoomError)) reportError(error);
          respond({ ok: false, error: protocolError });
        }).finally(() => { busy = false; });
      };
    const unbound = () => { if (bindings.has(socket.id)) throw new RoomError("WRONG_PHASE", "Already in a room"); };
    const current = (): Binding => {
      const binding = bindings.get(socket.id);
      if (!binding) throw new RoomError("UNAUTHORIZED", "Join a room first");
      binding.room.authorize(binding.side, socket.id);
      return binding;
    };
    const findRoom = (code: string): GameRoom => {
      const room = rooms.get(code);
      if (!room) throw new RoomError("NOT_FOUND", "Room not found or expired");
      return room;
    };
    socket.on("createRoom", wrap(createRoomSchema, async (payload) => {
      unbound();
      const replay = payload.replay ? await replayStore.load(payload.replay).catch(() => { throw new RoomError("NOT_FOUND", "Completed replay not found"); }) : undefined;
      const scenarioId = replay?.header.scenarioId ?? payload.scenarioId;
      if (!isScenarioId(scenarioId)) throw new RoomError("INVALID_PAYLOAD", "Unknown scenario");
      if (!socket.connected || closing) throw new RoomError("UNAUTHORIZED", "Connection closed");
      const address = socket.handshake.address;
      if (rooms.size >= maxRooms || [...roomOwners.values()].filter((owner) => owner === address).length >= 8) throw new RoomError("CAPACITY", "Server room capacity reached");
      const code = makeCode(rooms);
      const room = new GameRoom({ code, nickname: payload.nickname, scenarioId, seed: payload.seed, timing: payload.timing, provider, replayStore, replay, timingOverride: options.timingOverride, emit: (connectionId, state) => io.sockets.sockets.get(connectionId)?.emit("roomState", state), reportError });
      rooms.set(code, room);
      roomOwners.set(code, address);
      bindings.set(socket.id, { room, side: "a" });
      return room.attach("a", socket.id);
    }));
    socket.on("joinRoom", wrap(joinRoomSchema, (payload) => {
      unbound();
      const room = findRoom(payload.code);
      const session = room.join(payload.nickname, socket.id);
      bindings.set(socket.id, { room, side: session.side });
      return session;
    }));
    socket.on("reconnectRoom", wrap(reconnectRoomSchema, (payload) => {
      const previous = bindings.get(socket.id);
      const room = findRoom(payload.code);
      if (previous && previous.room !== room) throw new RoomError("WRONG_PHASE", "Already in another room");
      if (previous && room.players[previous.side]?.token !== payload.token) throw new RoomError("UNAUTHORIZED", "Cannot change seats on an active connection");
      const session = room.reconnect(payload.token, socket.id);
      bindings.set(socket.id, { room, side: session.side });
      return session;
    }));
    socket.on("startGame", wrap(startGameSchema, async () => { const { room, side } = current(); await room.start(side); return {}; }));
    socket.on("submitPrompt", wrap(submitPromptSchema, (payload) => { const { room, side } = current(); room.submit(side, payload); return {}; }));
    socket.on("disconnect", () => { const binding = bindings.get(socket.id); binding?.room.disconnect(socket.id); bindings.delete(socket.id); });
  });

  return {
    io, rooms, cleanup,
    async close(): Promise<void> {
      closing = true;
      clearInterval(cleanupTimer);
      await Promise.all([...rooms.values()].map((room) => room.close().catch(reportError)));
      rooms.clear(); bindings.clear(); roomOwners.clear();
      await new Promise<void>((resolveClose) => io.close(() => resolveClose()));
    },
  };
}

function safeOrigin(origin: string, host: string | undefined): boolean {
  try { const url = new URL(origin); return (url.protocol === "http:" || url.protocol === "https:") && url.host === host; } catch { return false; }
}
function makeCode(rooms: ReadonlyMap<string, GameRoom>): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let attempt = 0; attempt < 20; attempt++) {
    const code = Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join("");
    if (!rooms.has(code)) return code;
  }
  throw new RoomError("CAPACITY", "Could not allocate room code");
}

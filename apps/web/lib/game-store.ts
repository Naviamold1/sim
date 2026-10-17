"use client";

import { create } from "zustand";
import { io, type Socket } from "socket.io-client";
import { reconnectRoomSchema, type ClientToServerEvents, type CreateRoomPayload, type JoinRoomPayload, type RoomState, type ServerToClientEvents, type Session, type SubmitPromptPayload, type Ack } from "../shared/protocol";

type Connection = "connecting" | "connected" | "offline";
type SavedSession = Pick<Session, "code" | "token">;
interface GameStore {
  room: RoomState | null;
  connection: Connection;
  initialized: boolean;
  pending: boolean;
  error: string | null;
  clockOffset: number;
  initialize: () => void;
  createRoom: (payload: CreateRoomPayload) => void;
  joinRoom: (payload: JoinRoomPayload) => void;
  startGame: () => void;
  submitPrompt: (payload: SubmitPromptPayload) => void;
  clearError: () => void;
  leave: () => void;
}

const storageKey = "politics-battle.session.v1";
let socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;
let savedSession: SavedSession | null = null;
let requestSerial = 0;

function saveSession(session: SavedSession | null) {
  savedSession = session;
  try {
    if (session) sessionStorage.setItem(storageKey, JSON.stringify(session));
    else sessionStorage.removeItem(storageKey);
  } catch {
    useGameStore.setState({ error: "Browser storage is unavailable. Keep this tab open to retain your seat." });
  }
}

function receiveState(room: RoomState) {
  const previous = useGameStore.getState().room;
  if (previous?.gameId === room.gameId && previous.revision > room.revision) return;
  useGameStore.setState({ room, clockOffset: room.serverNow - Date.now() });
}

function request<T>(send: (reply: (response: Ack<T>) => void) => void, success: (data: T) => void) {
  if (!socket?.connected) {
    useGameStore.setState({ error: "You’re offline. Reconnecting automatically; your seat is saved." });
    return;
  }
  if (useGameStore.getState().pending) return;
  const serial = ++requestSerial;
  useGameStore.setState({ pending: true, error: null });
  const timeout = setTimeout(() => {
    if (serial !== requestSerial) return;
    requestSerial += 1;
    useGameStore.setState({ pending: false, error: "The server did not respond. Check your connection and try again." });
  }, 15000);
  send((response) => {
    clearTimeout(timeout);
    if (serial !== requestSerial) return;
    useGameStore.setState({ pending: false });
    if (response.ok) success(response.data);
    else useGameStore.setState({ error: response.error.message });
  });
}

function acceptSession(session: Session) {
  saveSession({ code: session.code, token: session.token });
  receiveState(session.state);
}

export const useGameStore = create<GameStore>((set, get) => ({
  room: null,
  connection: "connecting",
  initialized: false,
  pending: false,
  error: null,
  clockOffset: 0,
  initialize: () => {
    if (get().initialized) return;
    set({ initialized: true });
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (raw) {
        const parsed = reconnectRoomSchema.safeParse(JSON.parse(raw));
        if (parsed.success) savedSession = parsed.data;
        else sessionStorage.removeItem(storageKey);
      }
    } catch {
      set({ error: "Could not restore your saved session. You can create or join a room below." });
    }
    socket = io({ autoConnect: false, reconnection: true });
    socket.on("roomState", receiveState);
    socket.on("error", (error) => set({ error: error.message }));
    socket.on("connect_error", () => set({ connection: "offline" }));
    socket.on("disconnect", () => {
      requestSerial += 1;
      set({ connection: "offline", pending: false });
    });
    socket.on("connect", () => {
      set({ connection: "connected", error: null });
      if (!savedSession || !socket) return;
      set({ pending: true });
      socket.timeout(15000).emit("reconnectRoom", savedSession, (timeoutError, response) => {
        set({ pending: false });
        if (timeoutError) {
          set({ error: "Session recovery timed out. Refresh to try again; your saved seat is retained." });
        } else if (response.ok) acceptSession(response.data);
        else {
          if (response.error.code === "NOT_FOUND" || response.error.code === "UNAUTHORIZED") {
            saveSession(null);
            set({ room: null });
          }
          set({ error: response.error.message });
        }
      });
    });
    socket.connect();
  },
  createRoom: (payload) => request<Session>((reply) => socket?.emit("createRoom", payload, reply), acceptSession),
  joinRoom: (payload) => request<Session>((reply) => socket?.emit("joinRoom", payload, reply), acceptSession),
  startGame: () => request<Record<string, never>>((reply) => socket?.emit("startGame", {}, reply), () => undefined),
  submitPrompt: (payload) => request<Record<string, never>>((reply) => socket?.emit("submitPrompt", payload, reply), () => undefined),
  clearError: () => set({ error: null }),
  leave: () => {
    requestSerial += 1;
    socket?.disconnect();
    saveSession(null);
    set({ room: null, pending: false, error: null });
    socket?.connect();
  },
}));

import { z } from "zod";
import type { ScenarioId } from "@pb/scenarios";
import type { AppliedEvent, Candidate, Contribution, ElectionNarration, ElectionResult, PerSide, PollResult, Quote, Side, TurnRecord } from "@pb/sim";

export const phases = ["lobby", "startPrompt", "yearSim", "yearRecap", "turn", "resolving", "election", "end"] as const;
export type Phase = typeof phases[number];
export const nicknameSchema = z.string().trim().min(1).max(32);
export const roomCodeSchema = z.string().trim().toUpperCase().regex(/^[A-Z2-9]{6}$/);
export const gameIdSchema = z.string().uuid();
export const createRoomSchema = z.object({ nickname: nicknameSchema, scenarioId: z.string().max(64).default("uk"), timing: z.enum(["normal", "demo"]).default("demo"), seed: z.string().min(1).max(128).optional(), replay: gameIdSchema.optional() }).strict();
export const joinRoomSchema = z.object({ code: roomCodeSchema, nickname: nicknameSchema }).strict();
export const startGameSchema = z.object({}).strict();
export const submitPromptSchema = z.object({ phase: z.enum(["startPrompt", "turn"]), year: z.number().int().min(0).max(4), prompt: z.string().trim().max(12000) }).strict();
export const reconnectRoomSchema = z.object({ code: roomCodeSchema, token: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export type CreateRoomPayload = z.input<typeof createRoomSchema>;
export type JoinRoomPayload = z.input<typeof joinRoomSchema>;
export type SubmitPromptPayload = z.input<typeof submitPromptSchema>;
export type ReconnectRoomPayload = z.input<typeof reconnectRoomSchema>;
export type PublicCandidate = Pick<Candidate, "side" | "nickname" | "name" | "party" | "ideology" | "background" | "bio" | "slogan" | "strengths" | "weaknesses" | "positions" | "trust" | "charisma" | "credibility" | "promises">;
export interface PublicPlayer { side: Side; nickname: string; connected: boolean; submitted: boolean }
export interface PublicRecap { year: number; final: boolean; events: AppliedEvent[]; turns: PerSide<TurnRecord | null>; breakdown: Contribution[]; quotes: Quote[]; poll: PollResult | null; pending: boolean }
export interface RoomState {
  code: string;
  gameId: string;
  scenarioId: ScenarioId;
  timing: "normal" | "demo";
  phase: Phase;
  year: number;
  revision: number;
  serverNow: number;
  deadline: number | null;
  self: Side;
  host: Side;
  players: PublicPlayer[];
  candidates: PerSide<PublicCandidate> | null;
  ownCandidate: Candidate | null;
  recap: PublicRecap | null;
  recaps: PublicRecap[];
  poll: PollResult | null;
  election: ElectionResult | null;
  narration: ElectionNarration | null;
  replay: boolean;
  error: ProtocolError | null;
}
export type ErrorCode = "INVALID_PAYLOAD" | "NOT_FOUND" | "ROOM_FULL" | "UNAUTHORIZED" | "WRONG_PHASE" | "ALREADY_SUBMITTED" | "CAPACITY" | "RATE_LIMIT" | "INTERNAL";
export interface ProtocolError { code: ErrorCode; message: string }
export type Ack<T = Record<string, never>> = { ok: true; data: T } | { ok: false; error: ProtocolError };
export interface Session { code: string; gameId: string; side: Side; token: string; state: RoomState }
export type Reply<T = Record<string, never>> = (response: Ack<T>) => void;
export interface ClientToServerEvents {
  createRoom: (payload: CreateRoomPayload, ack: Reply<Session>) => void;
  joinRoom: (payload: JoinRoomPayload, ack: Reply<Session>) => void;
  startGame: (payload: Record<string, never>, ack: Reply) => void;
  submitPrompt: (payload: SubmitPromptPayload, ack: Reply) => void;
  reconnectRoom: (payload: ReconnectRoomPayload, ack: Reply<Session>) => void;
}
export interface ServerToClientEvents { roomState: (state: RoomState) => void; error: (error: ProtocolError) => void }

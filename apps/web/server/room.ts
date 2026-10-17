import { randomBytes, randomUUID } from "node:crypto";
import { createGameAi, type AiProvider, type GameAi } from "@pb/ai";
import { getScenario, type ScenarioId } from "@pb/scenarios";
import { beginYear, createGame, finishYear, rollCorruption, runElection, selectPersonas, type CandidateProfile, type DirectorOutput, type ElectionNarration, type ElectionResult, type GameState, type PendingYear, type PerSide, type Side, type TurnInterpretation } from "@pb/sim";
import type { ErrorCode, Phase, ProtocolError, RoomState, Session, SubmitPromptPayload } from "../shared/protocol";
import { publicCandidate, publicRecap } from "./public-state";
import { ReplayStore, type ReplayData, type ReplayWriter } from "./replay";

export class RoomError extends Error {
  constructor(readonly code: ErrorCode, message: string) { super(message); }
}
export interface RoomTiming { startPrompt: number; turn: number; recap: number; election: number }
export const timingPresets: Record<"normal" | "demo", RoomTiming> = {
  normal: { startPrompt: 120000, turn: 45000, recap: 3000, election: 5000 },
  demo: { startPrompt: 45000, turn: 20000, recap: 2500, election: 5000 },
};
interface Player { nickname: string; token: string; connectionId: string | null; submitted: boolean; prompt: string }
export interface RoomOptions {
  code: string; nickname: string; scenarioId: ScenarioId; seed?: string; timing: "normal" | "demo";
  provider: AiProvider; replayStore: ReplayStore; replay?: ReplayData; timingOverride?: Partial<RoomTiming>;
  emit: (connectionId: string, state: RoomState) => void;
  reportError?: (error: unknown) => void;
}

export class GameRoom {
  readonly gameId = randomUUID();
  readonly code: string;
  readonly scenarioId: ScenarioId;
  readonly seed: string;
  readonly players: Partial<PerSide<Player>> = {};
  readonly createdAt = Date.now();
  lastActive = Date.now();
  phase: Phase = "lobby";
  deadline: number | null = null;
  closed = false;
  private revision = 0;
  private state: GameState | null = null;
  private pending: PendingYear | null = null;
  private election: ElectionResult | null = null;
  private narration: ElectionNarration | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private ai: GameAi | null = null;
  private writer: ReplayWriter | null = null;
  private profiles: Partial<PerSide<Promise<CandidateProfile>>> = {};
  private turns: Partial<PerSide<Promise<TurnInterpretation | null>>> = {};
  private director: Promise<DirectorOutput> | null = null;
  private starting = false;
  private terminalError: ProtocolError | null = null;
  private readonly timing: RoomTiming;
  private readonly scenario;

  constructor(private readonly options: RoomOptions) {
    this.code = options.code;
    this.scenarioId = options.scenarioId;
    this.seed = options.replay?.header.seed ?? options.seed ?? randomBytes(16).toString("hex");
    this.scenario = getScenario(this.scenarioId);
    const desired = { ...timingPresets[options.timing], ...options.timingOverride };
    this.timing = {
      startPrompt: bounded(desired.startPrompt, 120000), turn: bounded(desired.turn, 45000),
      recap: bounded(desired.recap, 10000), election: bounded(desired.election, 30000),
    };
    this.players.a = this.newPlayer(options.replay?.header.nicknames.a ?? options.nickname);
  }

  private newPlayer(nickname: string): Player { return { nickname, token: randomBytes(32).toString("hex"), connectionId: null, submitted: false, prompt: "" }; }
  private player(side: Side): Player {
    const player = this.players[side];
    if (!player) throw new RoomError("NOT_FOUND", "Player not found");
    return player;
  }
  attach(side: Side, connectionId: string): Session {
    const player = this.player(side);
    player.connectionId = connectionId;
    this.lastActive = Date.now();
    this.broadcast();
    return { code: this.code, gameId: this.gameId, side, token: player.token, state: this.snapshot(side) };
  }
  join(nickname: string, connectionId: string): Session {
    if (this.phase !== "lobby" || this.starting || this.players.b) throw new RoomError("ROOM_FULL", "Room already has two players");
    this.players.b = this.newPlayer(this.options.replay?.header.nicknames.b ?? nickname);
    return this.attach("b", connectionId);
  }
  reconnect(token: string, connectionId: string): Session {
    const side = (["a", "b"] as const).find((candidate) => this.players[candidate]?.token === token);
    if (!side) throw new RoomError("UNAUTHORIZED", "Invalid reconnection token");
    return this.attach(side, connectionId);
  }
  authorize(side: Side, connectionId: string): void {
    if (this.closed || this.player(side).connectionId !== connectionId) throw new RoomError("UNAUTHORIZED", "Session was replaced or disconnected");
  }
  disconnect(connectionId: string): void {
    for (const side of ["a", "b"] as const) {
      const player = this.players[side];
      if (player?.connectionId === connectionId) player.connectionId = null;
    }
    this.lastActive = Date.now();
    this.broadcast();
  }
  get connected(): boolean { return Object.values(this.players).some((player) => player.connectionId !== null); }

  async start(side: Side): Promise<void> {
    if (side !== "a") throw new RoomError("UNAUTHORIZED", "Only the host can start");
    if (this.phase !== "lobby" || this.starting) throw new RoomError("WRONG_PHASE", "Game already started");
    if (!this.players.b || !this.players.a?.connectionId || !this.players.b.connectionId) throw new RoomError("WRONG_PHASE", "Both players must be connected");
    this.starting = true;
    try {
      if (!this.options.replay) this.writer = await this.options.replayStore.create({ kind: "header", version: 1, gameId: this.gameId, scenarioId: this.scenarioId, seed: this.seed, nicknames: { a: this.player("a").nickname, b: this.player("b").nickname } });
      if (this.closed) { await this.writer?.close(); return; }
      this.ai = createGameAi({ provider: this.options.provider, scenario: this.scenario, timeoutMs: 4000, totalTimeoutMs: 8000, attempts: 2, replay: this.options.replay?.outputs, onRecord: (record) => this.writer?.write({ kind: "ai", record }) });
      this.setPhase("startPrompt", this.timing.startPrompt, () => this.finishPrompts());
      this.replayPrompts();
    } finally { this.starting = false; }
  }

  submit(side: Side, payload: SubmitPromptPayload): void {
    if (this.options.replay) throw new RoomError("WRONG_PHASE", "Recorded prompts are played automatically");
    if (this.deadline !== null && Date.now() >= this.deadline) throw new RoomError("WRONG_PHASE", "The submission deadline has passed");
    this.acceptPrompt(side, payload);
  }

  private acceptPrompt(side: Side, payload: SubmitPromptPayload): void {
    if (this.closed || this.phase !== payload.phase || (this.state?.year ?? 0) !== payload.year) throw new RoomError("WRONG_PHASE", "Prompt does not match the current phase and year");
    const player = this.player(side);
    if (player.submitted) throw new RoomError("ALREADY_SUBMITTED", "Prompt already submitted");
    player.submitted = true;
    player.prompt = payload.prompt;
    this.writer?.write({ kind: "prompt", side, year: payload.year, prompt: payload.prompt });
    const ai = this.requireAi();
    if (this.phase === "startPrompt") this.profiles[side] = ai.buildProfile(`profile:${side}`, { nickname: player.nickname, prompt: payload.prompt }).then((result) => result.output);
    else if (this.state) this.turns[side] = payload.prompt ? ai.interpretTurn(`turn:${this.state.year}:${side}`, { state: this.state, side, prompt: payload.prompt }).then((result) => result.output) : Promise.resolve(null);
    this.broadcast();
    if (this.player("a").submitted && this.player("b").submitted) this.launch(() => this.finishPrompts());
  }

  private replayPrompts(): void {
    if (!this.options.replay || (this.phase !== "startPrompt" && this.phase !== "turn")) return;
    const phase = this.phase;
    const year = this.state?.year ?? 0;
    for (const side of ["a", "b"] as const) this.acceptPrompt(side, { phase, year, prompt: this.options.replay.prompts.get(`${year}:${side}`) ?? "" });
  }

  private async finishPrompts(): Promise<void> {
    if (this.phase !== "startPrompt" && this.phase !== "turn") return;
    const isStart = this.phase === "startPrompt";
    for (const side of ["a", "b"] as const) if (!this.player(side).submitted) this.acceptPrompt(side, { phase: isStart ? "startPrompt" : "turn", year: this.state?.year ?? 0, prompt: "" });
    this.setPhase(isStart ? "yearSim" : "resolving");
    if (isStart) {
      const [profileA, profileB] = await Promise.all([this.profiles.a, this.profiles.b]);
      if (this.closed) return;
      if (!profileA || !profileB) throw new Error("Missing candidate profiles");
      this.state = createGame(this.scenario, this.seed, { a: { nickname: this.player("a").nickname, profile: profileA }, b: { nickname: this.player("b").nickname, profile: profileB } });
      this.director = this.requestDirector();
    }
    const [turnA, turnB, director] = await Promise.all([this.turns.a ?? null, this.turns.b ?? null, this.director]);
    if (this.closed) return;
    if (!this.state || !director) throw new Error("Missing year inputs");
    const begun = beginYear(this.state, this.scenario, { turns: { a: turnA, b: turnB }, director });
    this.state = begun.state;
    this.pending = begun.pending;
    this.setPhase("yearRecap");
    const focus = await this.requireAi().focusGroup(`focus:${begun.pending.year}`, { state: begun.state, pending: begun.pending, personas: selectPersonas(begun.state, this.scenario) });
    if (this.closed) return;
    const finished = finishYear(begun.state, this.scenario, begun.pending, focus.output);
    this.state = finished.state;
    this.pending = null;
    this.setPhase("yearRecap", this.timing.recap, () => begun.pending.final ? this.finishElection() : this.openTurn());
  }

  private requestDirector(): Promise<DirectorOutput> {
    if (!this.state) throw new Error("Missing game state");
    return this.requireAi().director(`director:${this.state.year + 1}`, { state: this.state, exposures: rollCorruption(this.state, this.scenario) }).then((result) => result.output);
  }
  private openTurn(): void {
    this.turns = {};
    for (const side of ["a", "b"] as const) { this.player(side).submitted = false; this.player(side).prompt = ""; }
    this.director = this.requestDirector();
    this.setPhase("turn", this.timing.turn, () => this.finishPrompts());
    this.replayPrompts();
  }
  private async finishElection(): Promise<void> {
    if (!this.state) throw new Error("Missing game state");
    this.election = runElection(this.state, this.scenario);
    this.setPhase("election");
    const narration = await this.requireAi().electionNarration("election", { state: this.state, result: this.election });
    if (this.closed) return;
    this.narration = narration.output;
    await this.writer?.close(true);
    if (this.closed) return;
    this.setPhase("election", this.timing.election, () => this.setPhase("end"));
  }
  private requireAi(): GameAi { if (!this.ai) throw new Error("AI not initialized"); return this.ai; }
  private setPhase(phase: Phase, duration?: number, next?: () => void | Promise<void>): void {
    if (this.closed) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.phase = phase;
    this.deadline = duration === undefined ? null : Date.now() + duration;
    if (duration !== undefined && next) { this.timer = setTimeout(() => this.launch(next), duration); this.timer.unref(); }
    this.lastActive = Date.now();
    this.broadcast();
  }
  private launch(work: () => void | Promise<void>): void {
    void Promise.resolve().then(work).catch((error: unknown) => {
      this.options.reportError?.(error);
      this.terminalError = { code: "INTERNAL", message: "The game stopped after an unexpected server error. Please create a new room." };
      this.setPhase("end");
      void this.writer?.close().catch((closeError: unknown) => this.options.reportError?.(closeError));
    });
  }
  private broadcast(): void {
    if (this.closed) return;
    this.revision++;
    for (const side of ["a", "b"] as const) { const id = this.players[side]?.connectionId; if (id) this.options.emit(id, this.snapshot(side)); }
  }
  snapshot(side: Side): RoomState {
    const state = this.state;
    return {
      code: this.code, gameId: this.gameId, scenarioId: this.scenarioId, timing: this.options.timing,
      phase: this.phase, year: Math.min(4, this.pending?.year ?? state?.year ?? 0), revision: this.revision, serverNow: Date.now(), deadline: this.deadline,
      self: side, host: "a", players: (["a", "b"] as const).flatMap((candidate) => { const player = this.players[candidate]; return player ? [{ side: candidate, nickname: player.nickname, connected: player.connectionId !== null, submitted: player.submitted }] : []; }),
      candidates: state ? { a: publicCandidate(state.candidates.a), b: publicCandidate(state.candidates.b) } : null,
      ownCandidate: state ? structuredClone(state.candidates[side]) : null,
      recap: this.pending ? publicRecap(this.pending, side) : state?.recaps.at(-1) ? publicRecap(state.recaps.at(-1)!, side) : null,
      recaps: state?.recaps.map((recap) => publicRecap(recap, side)) ?? [], poll: state?.polls.at(-1) ?? null,
      election: this.election ? structuredClone(this.election) : null, narration: this.narration ? structuredClone(this.narration) : null, replay: Boolean(this.options.replay), error: this.terminalError,
    };
  }
  async close(): Promise<void> {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.writer?.close();
  }
}

function bounded(value: number, maximum: number): number { return Number.isFinite(value) ? Math.max(1, Math.min(maximum, Math.floor(value))) : maximum; }

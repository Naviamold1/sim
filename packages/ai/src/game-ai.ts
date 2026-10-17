import type { Scenario } from "@pb/scenarios";
import type {
  CandidateProfile,
  DirectorOutput,
  ElectionNarration,
  ElectionResult,
  Exposure,
  FocusGroupOutput,
  GameState,
  PendingYear,
  Persona,
  Side,
  TurnInterpretation,
} from "@pb/sim";
import { z } from "zod";
import { withDeadline, type AiProvider, type AiTask } from "./provider";
import { availableTemplates } from "./context";
import { directorSchema, focusGroupSchema, narrationSchema, profileSchema, turnSchema } from "./schemas";
import { eligibleRegions, fallbackDirector, fallbackFocusGroup, fallbackNarration, fallbackProfile, fallbackTurn, mentionsCorruption } from "./fallbacks";
import { buildProfilePrompt } from "./prompts/buildProfile";
import { interpretTurnPrompt } from "./prompts/interpretTurn";
import { directorPrompt } from "./prompts/director";
import { focusGroupPrompt } from "./prompts/focusGroup";
import { electionNarrationPrompt } from "./prompts/electionNarration";
import type { Prompt } from "./prompts/common";
import { publicTurnSummary, sanitizeDirector, sanitizeFocusGroup, sanitizeNarration, sanitizeProfile, sanitizeTurn } from "./sanitize";

export type AiSource = "model" | "fallback" | "replay";

export interface AiResult<T> {
  output: T;
  source: AiSource;
  latencyMs: number;
}

/** One logged AI output. A game's records + seed are enough to replay it with zero model calls. */
export interface AiCallRecord {
  key: string;
  task: AiTask;
  source: Exclude<AiSource, "replay">;
  latencyMs: number;
  output: unknown;
}

export interface GameAiOptions {
  provider: AiProvider;
  scenario: Scenario;
  /** Per-attempt timeout (default 4000ms). */
  timeoutMs?: number;
  /** Attempts before falling back (default 2). */
  attempts?: number;
  /** Total wall-clock budget across attempts (default 8000ms, hard maximum 10000ms). */
  totalTimeoutMs?: number;
  /** Recorded outputs by call key. When set, recorded outputs are re-validated and returned, the provider is never called. */
  replay?: ReadonlyMap<string, unknown>;
  onRecord?: (record: AiCallRecord) => void;
}

export interface GameAi {
  buildProfile(key: string, input: { nickname: string; prompt: string }): Promise<AiResult<CandidateProfile>>;
  interpretTurn(key: string, input: { state: GameState; side: Side; prompt: string }): Promise<AiResult<TurnInterpretation>>;
  /** Only needs world state, so it can run while players type. `exposures` = `rollCorruption(state)`. */
  director(key: string, input: { state: GameState; exposures: Exposure[] }): Promise<AiResult<DirectorOutput>>;
  focusGroup(
    key: string,
    input: { state: GameState; pending: PendingYear; personas: Persona[] },
  ): Promise<AiResult<FocusGroupOutput>>;
  electionNarration(key: string, input: { state: GameState; result: ElectionResult }): Promise<AiResult<ElectionNarration>>;
}

/** Never rejects: every call ends in a model, replayed, or deterministic fallback output. */
export function createGameAi(options: GameAiOptions): GameAi {
  const { scenario } = options;
  const bounded = (value: number | undefined, defaultValue: number, maximum: number) =>
    value === undefined || !Number.isFinite(value) ? defaultValue : Math.min(maximum, Math.max(1, Math.floor(value)));
  const timeoutMs = bounded(options.timeoutMs, 4000, 10000);
  const totalTimeoutMs = bounded(options.totalTimeoutMs, 8000, 10000);
  const attempts = bounded(options.attempts, 2, 3);
  const recordSchema = z.object({
    key: z.string(), task: z.enum(["buildProfile", "interpretTurn", "director", "focusGroup", "electionNarration"]),
    source: z.enum(["model", "fallback"]), latencyMs: z.number().finite().nonnegative(), output: z.unknown(),
  }).strict();

  async function run<T>(key: string, task: AiTask, prompt: () => Prompt, schema: z.ZodType<T>,
    fallback: () => T, sanitize: (output: T) => T): Promise<AiResult<T>> {
    const started = performance.now();
    const validated = (output: unknown): T => schema.parse(sanitize(schema.parse(output)));
    const finish = (output: T, source: AiSource): AiResult<T> => {
      const latencyMs = Math.max(0, performance.now() - started);
      if (source !== "replay") {
        try { options.onRecord?.({ key, task, source, latencyMs, output: structuredClone(output) }); } catch {}
      }
      return { output, source, latencyMs };
    };
    if (options.replay !== undefined) {
      try {
        const entry = options.replay.get(key);
        const record = recordSchema.safeParse(entry);
        if (record.success) {
          if (record.data.key !== key || record.data.task !== task) throw new Error("Replay task/key mismatch");
          return finish(validated(record.data.output), "replay");
        }
        return finish(validated(entry), "replay");
      } catch {
        return finish(validated(fallback()), "fallback");
      }
    }
    for (let attempt = 0; attempt < attempts; attempt++) {
      const remaining = totalTimeoutMs - (performance.now() - started);
      if (remaining < 1) break;
      try {
        const request = { ...prompt(), timeoutMs: Math.min(timeoutMs, remaining) };
        const output = await withDeadline(request.timeoutMs,
          (signal) => options.provider.run(task, { ...request, signal }, schema));
        return finish(validated(output), "model");
      } catch {}
    }
    return finish(validated(fallback()), "fallback");
  }

  return {
    buildProfile: (key, input) => run(key, "buildProfile", () => buildProfilePrompt(scenario, input), profileSchema(scenario),
      () => fallbackProfile(scenario, input), (output) => {
        const clean = sanitizeProfile(output, input.nickname);
        if (!mentionsCorruption(input.prompt)) return clean;
        const safe = fallbackProfile(scenario, { nickname: input.nickname, prompt: "" });
        return { ...clean, name: safe.name, party: safe.party, ideology: safe.ideology, bio: safe.bio,
          slogan: safe.slogan, strengths: safe.strengths, weaknesses: safe.weaknesses };
      }),
    interpretTurn: (key, input) => run(key, "interpretTurn", () => interpretTurnPrompt(scenario, input), turnSchema(scenario),
      () => fallbackTurn(scenario, input), (output) => {
        const clean = sanitizeTurn(output);
        if (!mentionsCorruption(input.prompt) && !clean.actions.some((action) => action.kind === "corruption")) return clean;
        return { ...clean, summary: publicTurnSummary(clean), actions: clean.actions.map((action) => action.kind === "corruption"
          ? action : { ...action, description: `${action.kind} campaign activity.` }) };
      }),
    director: (key, input) => {
      const schema = directorSchema(scenario, {
        templateIds: availableTemplates(scenario, input.state).filter(({ template }) =>
          template.target.national || eligibleRegions(scenario, template.id).length > 0).map(({ template }) => template.id),
        caseIds: input.exposures.map((exposure) => exposure.caseId),
      }).refine((output) => output.events.every((event) => event.templateId === null ||
        (input.state.world.templateUses[event.templateId] ?? 0) + output.events.filter((other) => other.templateId === event.templateId).length
          <= (scenario.events.templates.find((template) => template.id === event.templateId)?.maxPerGame ?? 0)), "Template uses exhausted");
      return run(key, "director", () => directorPrompt(scenario, input), schema,
        () => fallbackDirector(scenario, input), sanitizeDirector);
    },
    focusGroup: (key, input) => run(key, "focusGroup", () => focusGroupPrompt(scenario, input),
      focusGroupSchema(scenario, input.personas.map((persona) => persona.id)), () => fallbackFocusGroup(input.personas), sanitizeFocusGroup),
    electionNarration: (key, input) => run(key, "electionNarration", () => electionNarrationPrompt(scenario, input), narrationSchema(),
      () => fallbackNarration(input), sanitizeNarration),
  };
}

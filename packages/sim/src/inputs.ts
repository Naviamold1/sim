import { z } from "zod";

/**
 * Base shapes of everything the AI hands to the simulation. Ids are plain strings here;
 * `packages/ai` narrows them to scenario enums. The sim still treats every value as untrusted:
 * unknown ids are dropped and numbers are clamped again.
 *
 * Shapes follow OpenAI strict structured-output rules so they convert 1:1 to JSON Schema:
 * every property is required (optional = nullable), no records, no string length limits.
 */

export const SIDES = ["a", "b"] as const;
export const SideSchema = z.enum(SIDES);
export type Side = z.infer<typeof SideSchema>;

export const ActionKindSchema = z.enum(["statement", "promise", "reform", "media", "rally", "attack", "corruption"]);
export type ActionKind = z.infer<typeof ActionKindSchema>;

export const ChannelSchema = z.enum(["tv", "social"]);
export type Channel = z.infer<typeof ChannelSchema>;

export const CorruptionSizeSchema = z.enum(["small", "medium", "big"]);
export type CorruptionSize = z.infer<typeof CorruptionSizeSchema>;

/** Target value meaning "the whole country". */
export const NATIONAL = "national";

export const ActionSchema = z.object({
  kind: ActionKindSchema,
  /** Issue id for statement/promise/reform (and optionally attack/media). */
  issue: z.string().nullable(),
  /** Desired position on `issue`, -1..1. */
  stance: z.number().min(-1).max(1).nullable(),
  /** Region id, segment id, or "national". */
  target: z.string().nullable(),
  channel: ChannelSchema.nullable(),
  intensity: z.number().int().min(1).max(3),
  corruptionSize: CorruptionSizeSchema.nullable(),
  /** One short plain-language line, e.g. "Promises 300k council homes". */
  description: z.string(),
});
export type Action = z.infer<typeof ActionSchema>;

export const TurnInterpretationSchema = z.object({
  actions: z.array(ActionSchema).max(6),
  /** The prompt contradicts the candidate's earlier positions or promises. */
  flipFlop: z.boolean(),
  /** One public line for the recap. Must not reveal covert corruption. */
  summary: z.string(),
});
export type TurnInterpretation = z.infer<typeof TurnInterpretationSchema>;

export const CandidateProfileSchema = z.object({
  name: z.string(),
  party: z.string(),
  ideology: z.string(),
  /** Background id from the scenario. */
  background: z.string(),
  positions: z.array(z.object({ issue: z.string(), value: z.number().min(-1).max(1) })),
  charisma: z.number().min(0).max(1),
  trust: z.number().min(0).max(1),
  strengths: z.array(z.string()).max(3),
  weaknesses: z.array(z.string()).max(3),
  slogan: z.string(),
  /** Public 1-2 sentence bio shown to both players. */
  bio: z.string(),
});
export type CandidateProfile = z.infer<typeof CandidateProfileSchema>;

export const IssueDeltaSchema = z.object({ issue: z.string(), delta: z.number().min(-0.15).max(0.15) });
export type IssueDelta = z.infer<typeof IssueDeltaSchema>;

export const DirectorEventSchema = z.object({
  /** Template id from the scenario pool, or null for a custom event. */
  templateId: z.string().nullable(),
  severity: z.number().int().min(1).max(3),
  /** Target region ids. Empty = national. */
  regions: z.array(z.string()),
  headline: z.string(),
  description: z.string(),
  /** Custom events only. Every component is capped at ±0.15. */
  custom: z
    .object({
      salience: z.array(IssueDeltaSchema),
      positions: z.array(IssueDeltaSchema),
      engagement: z.number().min(-0.15).max(0.15),
    })
    .nullable(),
});
export type DirectorEvent = z.infer<typeof DirectorEventSchema>;

export const ExposureNarrativeSchema = z.object({
  caseId: z.string(),
  headline: z.string(),
  description: z.string(),
});
export type ExposureNarrative = z.infer<typeof ExposureNarrativeSchema>;

export const DirectorOutputSchema = z.object({
  events: z.array(DirectorEventSchema).min(1).max(2),
  /** Narration for each corruption exposure the sim rolled this year. */
  exposures: z.array(ExposureNarrativeSchema),
});
export type DirectorOutput = z.infer<typeof DirectorOutputSchema>;

export const ReactionSchema = z.object({
  /** Persona id (= segment id). */
  personaId: z.string(),
  affinityDelta: z.object({ a: z.number().min(-0.2).max(0.2), b: z.number().min(-0.2).max(0.2) }),
  engagementDelta: z.number().min(-0.1).max(0.1),
  salienceShift: z.object({ issue: z.string(), delta: z.number().min(-0.1).max(0.1) }).nullable(),
  quote: z.string(),
});
export type Reaction = z.infer<typeof ReactionSchema>;

export const FocusGroupOutputSchema = z.object({ reactions: z.array(ReactionSchema) });
export type FocusGroupOutput = z.infer<typeof FocusGroupOutputSchema>;

export const ElectionNarrationSchema = z.object({ headline: z.string(), story: z.string() });
export type ElectionNarration = z.infer<typeof ElectionNarrationSchema>;

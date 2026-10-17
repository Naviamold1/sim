import { z } from "zod";
import type { Scenario } from "@pb/scenarios";
import {
  ActionSchema,
  CandidateProfileSchema,
  DirectorEventSchema,
  DirectorOutputSchema,
  ElectionNarrationSchema,
  ExposureNarrativeSchema,
  FocusGroupOutputSchema,
  IssueDeltaSchema,
  NATIONAL,
  ReactionSchema,
  TurnInterpretationSchema,
  type CandidateProfile,
  type DirectorOutput,
  type ElectionNarration,
  type FocusGroupOutput,
  type TurnInterpretation,
} from "@pb/sim";
import { LIMITS } from "./sanitize";

const unique = (ids: readonly string[]) => new Set(ids).size === ids.length;
const text = (max: number) => z.string().max(max);

/**
 * Narrowed versions of the sim's base output schemas: ids become enums built from the scenario
 * (and from per-call data such as personas or exposures). The shapes are otherwise unchanged and
 * follow the same strict-structured-output rules (all properties required, no records).
 */

/** Enum of ids. Throws on an empty list because `z.enum` cannot represent it. */
function enumOf(ids: readonly string[], what: string) {
  const [first, ...rest] = [...new Set(ids)];
  if (first === undefined) throw new Error(`cannot build an enum of ${what}: no ids`);
  return z.enum([first, ...rest]);
}

const issueEnum = (scenario: Scenario) =>
  enumOf(
    scenario.issues.map((i) => i.id),
    "issues",
  );

/** Region ids, segment ids and "national". */
export function targetIds(scenario: Scenario): string[] {
  return [...scenario.map.regions.map((r) => r.id), ...scenario.segments.map((s) => s.id), NATIONAL];
}

export function profileSchema(scenario: Scenario) {
  const issue = issueEnum(scenario);
  return CandidateProfileSchema.extend({
    name: text(LIMITS.name).min(1), party: text(LIMITS.party), ideology: text(LIMITS.ideology),
    slogan: text(LIMITS.slogan), bio: text(LIMITS.bio),
    strengths: z.array(text(LIMITS.listItem)).max(3), weaknesses: z.array(text(LIMITS.listItem)).max(3),
    background: enumOf(
      scenario.backgrounds.map((b) => b.id),
      "backgrounds",
    ),
    positions: z.array(CandidateProfileSchema.shape.positions.element.extend({ issue }).strict()).max(scenario.issues.length)
      .refine((positions) => unique(positions.map((position) => position.issue)), "Duplicate issue"),
  }).strict();
}

/** The sim's per-turn cap on actions (`TurnInterpretationSchema.actions.max`). */
const MAX_ACTIONS = 6;

export function turnSchema(scenario: Scenario) {
  const issue = issueEnum(scenario).nullable();
  const target = enumOf(targetIds(scenario), "targets").nullable();
  return TurnInterpretationSchema.extend({
    summary: text(LIMITS.summary),
    actions: z.array(ActionSchema.extend({ issue, target, description: text(LIMITS.actionDescription) }).strict()
      .refine((action) => {
        if (action.kind !== "corruption" && action.corruptionSize !== null) return false;
        if (action.kind !== "media" && action.channel !== null) return false;
        if (action.stance !== null && action.issue === null) return false;
        if (["statement", "promise", "reform"].includes(action.kind)) return action.issue !== null && action.stance !== null;
        if (action.kind === "media") return action.channel !== null;
        if (action.kind === "rally") return action.target !== null && action.target !== NATIONAL;
        if (action.kind === "corruption") return action.corruptionSize !== null && action.issue === null && action.stance === null
          && action.target === null && action.channel === null;
        return true;
      }, "Action fields do not match kind")).max(MAX_ACTIONS),
  }).strict();
}

export interface DirectorSchemaInput {
  /** Template ids that still have uses left. */
  templateIds: readonly string[];
  /** Case ids of the exposures to narrate this call. */
  caseIds: readonly string[];
}

export function directorSchema(scenario: Scenario, input: DirectorSchemaInput) {
  const issue = issueEnum(scenario);
  const issueDelta = IssueDeltaSchema.extend({ issue }).strict();
  const deltas = z.array(issueDelta).max(scenario.issues.length)
    .refine((values) => unique(values.map((value) => value.issue)), "Duplicate issue delta");
  const regions = enumOf(
    scenario.map.regions.map((r) => r.id),
    "regions",
  );
  const custom = DirectorEventSchema.shape.custom.unwrap().extend({
    salience: deltas,
    positions: deltas,
  }).strict();
  const templateId = input.templateIds.length > 0 ? enumOf(input.templateIds, "templates").nullable() : z.null();
  const event = DirectorEventSchema.extend({ templateId,
    headline: text(LIMITS.headline), description: text(LIMITS.eventDescription),
    regions: z.array(regions).max(scenario.map.regions.length).refine(unique, "Duplicate region"), custom: custom.nullable(),
  }).strict().refine((value) => {
    if (value.templateId === null) return value.custom !== null;
    if (value.custom !== null) return false;
    const template = scenario.events.templates.find((entry) => entry.id === value.templateId);
    if (!template) return false;
    if (template.target.national) return value.regions.length === 0;
    return value.regions.length > 0 && value.regions.every((id) => {
      const region = scenario.map.regions.find((entry) => entry.id === id);
      return region !== undefined && (template.target.regions.length === 0 || template.target.regions.includes(id))
        && region.urban >= template.target.minUrban && region.urban <= template.target.maxUrban;
    });
  }, "Invalid template/custom event or targeting");

  // With nothing to narrate the array must be empty; otherwise exactly one narrative per case.
  const exposures =
    input.caseIds.length > 0
      ? z.array(ExposureNarrativeSchema.extend({ caseId: enumOf(input.caseIds, "cases"),
          headline: text(LIMITS.headline), description: text(LIMITS.eventDescription),
        }).strict()).length(input.caseIds.length)
          .refine((values) => unique(values.map((value) => value.caseId)), "Duplicate exposure")
      : z.array(ExposureNarrativeSchema).max(0);

  return DirectorOutputSchema.extend({ events: z.array(event).min(1).max(2), exposures }).strict();
}

export function focusGroupSchema(scenario: Scenario, personaIds: readonly string[]) {
  // Exactly one reaction per persona; with no personas the array must be empty.
  const reactions =
    personaIds.length > 0
      ? z
          .array(
            ReactionSchema.extend({
              personaId: enumOf(personaIds, "personas"),
              quote: text(LIMITS.quote),
              affinityDelta: ReactionSchema.shape.affinityDelta.strict(),
              salienceShift: ReactionSchema.shape.salienceShift.unwrap().extend({ issue: issueEnum(scenario) }).strict().nullable(),
            }).strict(),
          )
          .length(personaIds.length)
          .refine((values) => unique(values.map((value) => value.personaId)), "Duplicate persona")
      : z.array(ReactionSchema).max(0);
  return FocusGroupOutputSchema.extend({ reactions }).strict();
}

export function narrationSchema() {
  return ElectionNarrationSchema.extend({ headline: text(LIMITS.headline), story: text(LIMITS.story) }).strict();
}

/** Compile-time proof that each narrowed schema still produces what the sim expects. */
type AssertAssignable<Narrow extends Wide, Wide> = Narrow;
export type SchemaTypeChecks = [
  AssertAssignable<z.infer<ReturnType<typeof profileSchema>>, CandidateProfile>,
  AssertAssignable<z.infer<ReturnType<typeof turnSchema>>, TurnInterpretation>,
  AssertAssignable<z.infer<ReturnType<typeof directorSchema>>, DirectorOutput>,
  AssertAssignable<z.infer<ReturnType<typeof focusGroupSchema>>, FocusGroupOutput>,
  AssertAssignable<z.infer<ReturnType<typeof narrationSchema>>, ElectionNarration>,
];

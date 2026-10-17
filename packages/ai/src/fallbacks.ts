import type { Scenario } from "@pb/scenarios";
import { resolveTuning } from "@pb/scenarios";
import { createRng, type Action, type CandidateProfile, type DirectorOutput, type ElectionNarration,
  type ElectionResult, type Exposure, type FocusGroupOutput, type GameState, type Persona,
  type Side, type TurnInterpretation } from "@pb/sim";
import { availableTemplates, joinList } from "./context";
import { clip, LIMITS, publicTurnSummary } from "./sanitize";

const words = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
const matches = (text: string, phrase: string) => {
  const normalized = ` ${words(text).join(" ")} `;
  const term = words(phrase).join(" ");
  return term.length > 0 && normalized.includes(` ${term} `);
};
const clauses = (text: string) => text.slice(0, 4000).split(/[.;!\n]+|\band\b/i).map((part) => part.trim()).filter(Boolean);
const negated = (text: string) => /\b(no|not|never|without|against|refuse|reject|stop|oppose|avoid|don't|won't|cannot)\b/i.test(text);
export const mentionsCorruption = (text: string) => /\b(bribes?|bribery|kickbacks?|corruption|embezzle\w*|launder\w*|covert|secret|offshore|under the table)\b/i.test(text);

function commitsCorruption(text: string): boolean {
  return mentionsCorruption(text) && !negated(text)
    && !/\b(fight|combat|end|tackle|investigate|expose|report|ban|prosecute)\b/i.test(text)
    && (/\b(take|accept|pocket|steal|pay|offer|arrange|funnel|embezzle\w*|launder\w*)\b/i.test(text)
      || /^(?:i\s+(?:will\s+)?)?bribe\b/i.test(text));
}

const policies: Record<string, { negative: string[]; positive: string[] }> = {
  economy: { negative: ["public services", "bigger state", "nationalize", "nationalise", "welfare", "tax the rich"],
    positive: ["free market", "privatize", "privatise", "cut taxes", "tax cuts", "deregulation"] },
  immigration: { negative: ["open borders", "more open", "welcome refugees", "welcome immigrants"],
    positive: ["restrict immigration", "close borders", "deport", "border controls", "more restrictive"] },
  environment: { negative: ["green", "climate", "renewable", "renewables", "clean energy"],
    positive: ["growth first", "drill", "coal", "fossil fuels"] },
};

function positions(scenario: Scenario, text: string): CandidateProfile["positions"] {
  return scenario.issues.map((issue) => {
    let value = 0;
    for (const clause of clauses(text)) {
      const cues = policies[issue.id];
      const negative = [issue.negLabel, ...(cues?.negative ?? [])].some((term) => matches(clause, term));
      const positive = [issue.posLabel, ...(cues?.positive ?? [])].some((term) => matches(clause, term));
      if (negative !== positive) value = (negative ? -0.6 : 0.6) * (negated(clause) ? -1 : 1);
    }
    return { issue: issue.id, value };
  });
}

export function fallbackProfile(scenario: Scenario, input: { nickname: string; prompt: string }): CandidateProfile {
  const text = input.prompt.slice(0, 4000);
  const name = text.match(/\b(?:my name is|named|name:)\s+([^.;!\n,]{1,40})/i)?.[1];
  const background = scenario.backgrounds.find((entry) => matches(text, entry.id) || matches(text, entry.name));
  return {
    name: clip(name ?? input.nickname, LIMITS.name) || "Candidate", party: "Independent",
    ideology: "Pragmatic independent", background: (background ?? scenario.backgrounds[0])!.id,
    positions: positions(scenario, text), charisma: 0.5, trust: 0.5,
    strengths: ["Local engagement"], weaknesses: ["Untested platform"], slogan: "A voice for the country",
    bio: "An independent candidate presenting a platform to voters.",
  };
}

export function fallbackTurn(scenario: Scenario, input: { state: GameState; side: Side; prompt: string }): TurnInterpretation {
  const actions: Action[] = [];
  let budget = resolveTuning(scenario).actionPoints;
  for (const clause of clauses(input.prompt.slice(0, 1200))) {
    if (/\b(ignore|instructions|schema|100%|give me|set votes)\b/i.test(clause)) continue;
    let kind: Action["kind"] | null = null;
    if (commitsCorruption(clause)) kind = "corruption";
    else if (/\b(attack|criticize|criticise|opponent|smear)\b/i.test(clause)) kind = "attack";
    else if (/\b(rally|rallies|doorstep|canvass)\b/i.test(clause)) kind = "rally";
    else if (/\b(tv|television|social|ads|advertising|media|tiktok|facebook)\b/i.test(clause)) kind = "media";
    const stances = positions(scenario, clause);
    const stance = stances.find((entry) => entry.value !== 0);
    const issue = stance?.issue ?? scenario.issues.find((entry) => matches(clause, entry.id) || matches(clause, entry.name))?.id ?? null;
    if (kind === null && issue !== null) {
      kind = /\b(reform|legislate|enact|law)\b/i.test(clause) ? "reform"
        : /\b(promise|pledge|will|build|invest|fund)\b/i.test(clause) ? "promise" : "statement";
    }
    if (kind === null || (mentionsCorruption(clause) && kind !== "corruption")) continue;
    const region = scenario.map.regions.find((entry) => matches(clause, entry.id) || matches(clause, entry.name));
    const segment = scenario.segments.find((entry) => matches(clause, entry.id));
    let target = segment?.id ?? region?.id ?? "national";
    if (kind === "rally" && target === "national") target = scenario.map.regions[0]!.id;
    const intensity = Math.min(budget, /\b(massive|major|nationwide|million|big)\b/i.test(clause) ? 3 : 1);
    if (intensity <= 0 || actions.length >= 6) break;
    actions.push({ kind, issue: kind === "corruption" ? null : issue,
      stance: kind === "corruption" || issue === null ? null : stance?.value ?? input.state.candidates[input.side].positions[issue] ?? 0,
      target: kind === "corruption" ? null : target,
      channel: kind === "media" ? (/\b(tv|television)\b/i.test(clause) ? "tv" : "social") : null,
      intensity, corruptionSize: kind === "corruption" ? (/\b(big|massive|million|major)\b/i.test(clause) ? "big"
        : /\b(medium|thousand)\b/i.test(clause) ? "medium" : "small") : null,
      description: kind === "corruption" ? "Accepts covert campaign financing." : `${kind} campaign activity${issue ? ` on ${issue}` : ""}.`,
    });
    budget -= intensity;
  }
  const flipFlop = actions.some((action) => action.issue !== null && action.stance !== null
    && action.stance * (input.state.candidates[input.side].positions[action.issue] ?? 0) < -0.1);
  const turn = { actions, flipFlop, summary: "" };
  return { ...turn, summary: publicTurnSummary(turn) };
}

export function eligibleRegions(scenario: Scenario, templateId: string): string[] {
  const template = scenario.events.templates.find((entry) => entry.id === templateId);
  if (!template || template.target.national) return [];
  return scenario.map.regions.filter((region) => (template.target.regions.length === 0 || template.target.regions.includes(region.id))
    && region.urban >= template.target.minUrban && region.urban <= template.target.maxUrban).map((region) => region.id);
}

export function fallbackDirector(scenario: Scenario, input: { state: GameState; exposures: Exposure[] }): DirectorOutput {
  const rng = createRng(input.state.seed, "ai-director", input.state.year + 1);
  const templates = availableTemplates(scenario, input.state)
    .filter(({ template }) => template.target.national || eligibleRegions(scenario, template.id).length > 0);
  const selected = templates[rng.weighted(templates.map(({ template }) => template.weight))]?.template;
  const eligible = selected ? eligibleRegions(scenario, selected.id) : [];
  const regions = eligible.length > 0 ? [eligible[rng.int(eligible.length)]!] : [];
  const names = joinList(regions.map((id) => scenario.map.regions.find((region) => region.id === id)!.name)) || scenario.meta.country;
  return {
    events: [selected ? { templateId: selected.id, severity: 1, regions, custom: null,
      headline: clip(selected.headline.replaceAll("{region}", names), LIMITS.headline),
      description: clip(selected.description.replaceAll("{region}", names), LIMITS.eventDescription),
    } : { templateId: null, severity: 1, regions: [], headline: "Campaign debate continues",
      description: "Voters weigh the candidates' public platforms.", custom: { salience: [], positions: [], engagement: 0 } }],
    exposures: input.exposures.map((exposure) => ({ caseId: exposure.caseId,
      headline: clip(`${input.state.candidates[exposure.side].name} faces funding scandal`, LIMITS.headline),
      description: "Investigators expose covert campaign financing. Voters question the candidate's integrity.",
    })),
  };
}

export function fallbackFocusGroup(personas: Persona[]): FocusGroupOutput {
  return { reactions: personas.map((persona) => ({ personaId: persona.id, affinityDelta: { a: 0, b: 0 },
    engagementDelta: 0, salienceShift: null, quote: "I am weighing the public campaign before deciding." })) };
}

export function fallbackNarration(input: { state: GameState; result: ElectionResult }): ElectionNarration {
  const winner = input.state.candidates[input.result.winner].name;
  const share = (input.result.national.share[input.result.winner] * 100).toFixed(1);
  const exposed = Object.values(input.state.candidates).some((candidate) => candidate.corruptionCases.some((entry) => entry.exposed));
  return { headline: clip(`${winner} wins the election`, LIMITS.headline),
    story: clip(`${winner} wins under the ${input.result.system} system, with ${share}% of the national vote. Turnout is ${(input.result.national.turnout * 100).toFixed(1)}%.${exposed ? " Publicly exposed funding scandals became part of the campaign." : ""}`, LIMITS.story) };
}

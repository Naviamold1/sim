import type { Background, Scenario, Tuning } from "@pb/scenarios";
import type { CandidateProfile, Side } from "./inputs";
import { indexScenario } from "./scenarioIndex";
import type { Candidate, GameState, IssueValues, PerSide, SegmentState } from "./types";
import { clamp, clamp01, clampSigned, clean, perSide } from "./util";

export interface NewCandidate {
  nickname: string;
  profile: CandidateProfile;
}

/**
 * Builds the initial state (year 0). Profiles are clamped: trust/charisma into the tuning bands,
 * unknown issues/backgrounds dropped, missing issues default to 0. Both candidates get equal
 * starting funds and visibility; background modifiers then apply.
 */
export function createGame(scenario: Scenario, seed: string, candidates: PerSide<NewCandidate>): GameState {
  const ix = indexScenario(scenario);
  const backgrounds = perSide((side) => backgroundFor(scenario, candidates[side].profile));

  const segments: Record<string, SegmentState> = {};
  for (const def of scenario.segments) {
    const affinity = perSide((side) => {
      let total = 0;
      for (const m of backgrounds[side].modifiers.affinity) {
        const matches =
          (m.classIds.length === 0 || m.classIds.includes(def.classId)) &&
          (m.ageIds.length === 0 || m.ageIds.includes(def.ageId)) &&
          (m.regionIds.length === 0 || m.regionIds.includes(def.regionId));
        if (matches) total += m.delta;
      }
      return clampSigned(total);
    });
    segments[def.id] = {
      id: def.id,
      positions: { ...def.positions },
      salience: { ...def.salience },
      engagement: def.engagement,
      affinity,
    };
  }

  return {
    seed,
    scenarioId: scenario.meta.id,
    year: 0,
    candidates: perSide((side) => buildCandidate(scenario, side, candidates[side], backgrounds[side], ix.tuning)),
    segments,
    world: { salienceModifiers: Object.fromEntries(ix.issueIds.map((id) => [id, 0])), templateUses: {}, events: [] },
    polls: [],
    recaps: [],
  };
}

function backgroundFor(scenario: Scenario, profile: CandidateProfile): Background {
  const found = indexScenario(scenario).backgroundById.get(profile.background);
  return found ?? scenario.backgrounds[0]!;
}

function buildCandidate(
  scenario: Scenario,
  side: Side,
  { nickname, profile }: NewCandidate,
  bg: Background,
  tuning: Tuning,
): Candidate {
  const ix = indexScenario(scenario);
  const positions: IssueValues = Object.fromEntries(ix.issueIds.map((id) => [id, 0]));
  for (const { issue, value } of profile.positions) {
    if (Object.hasOwn(positions, issue)) positions[issue] = clampSigned(value);
  }
  const short = (items: string[]) => items.slice(0, 3).map((s) => clean(s, 60)).filter(Boolean);
  const nick = clean(nickname, 40);

  return {
    side,
    nickname: nick,
    name: clean(profile.name, 40) || nick,
    party: clean(profile.party, 40),
    ideology: clean(profile.ideology, 60),
    background: bg.id,
    bio: clean(profile.bio, 300),
    slogan: clean(profile.slogan, 80),
    strengths: short(profile.strengths),
    weaknesses: short(profile.weaknesses),
    positions,
    trust: clamp01(clamp(profile.trust, tuning.trustBand[0], tuning.trustBand[1]) + bg.modifiers.trust),
    charisma: clamp01(clamp(profile.charisma, tuning.charismaBand[0], tuning.charismaBand[1]) + bg.modifiers.charisma),
    credibility: 0.8,
    visibility: Object.fromEntries(scenario.map.regions.map((r) => [r.id, tuning.startingVisibility])),
    funds: Math.max(0, tuning.startingFunds + bg.modifiers.funds),
    promises: [],
    history: [],
    corruptionCases: [],
  };
}

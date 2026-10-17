import type { Scenario } from "@pb/scenarios";
import { testScenario } from "@pb/scenarios/testing";
import type { Action, CandidateProfile, DirectorOutput, FocusGroupOutput, TurnInterpretation } from "./inputs";
import { createGame } from "./game";
import type { GameState, IssueValues } from "./types";

/** Shared helpers for tests. Not part of the package API. */

export const scenario = testScenario;

export function profile(overrides: Partial<CandidateProfile> & { values?: IssueValues } = {}): CandidateProfile {
  const { values = {}, ...rest } = overrides;
  return {
    name: "Alex Example",
    party: "Example Party",
    ideology: "Pragmatist",
    background: "lawyer",
    positions: Object.entries(values).map(([issue, value]) => ({ issue, value })),
    charisma: 0.55,
    trust: 0.5,
    strengths: [],
    weaknesses: [],
    slogan: "Forward",
    bio: "A politician.",
    ...rest,
  };
}

/** Share-weighted mean position per issue. */
export function populationMean(s: Scenario): IssueValues {
  const mean: IssueValues = {};
  for (const issue of s.issues) {
    mean[issue.id] = s.segments.reduce((total, seg) => total + seg.share * (seg.positions[issue.id] ?? 0), 0);
  }
  return mean;
}

/** Two candidates with identical stats whose positions mirror each other around `center`. */
export function mirroredGame(s: Scenario, seed: string, spread: number, center: IssueValues = populationMean(s)): GameState {
  const side = (sign: 1 | -1, name: string) =>
    profile({
      name,
      values: Object.fromEntries(s.issues.map((i) => [i.id, (center[i.id] ?? 0) + sign * spread])),
    });
  return createGame(s, seed, {
    a: { nickname: "A", profile: side(1, "Aria Left") },
    b: { nickname: "B", profile: side(-1, "Boris Right") },
  });
}

export function newGame(s: Scenario = scenario, seed = "seed", a: Partial<CandidateProfile> = {}, b: Partial<CandidateProfile> = {}): GameState {
  const mean = populationMean(s);
  const near = (offset: number) => Object.fromEntries(s.issues.map((i) => [i.id, (mean[i.id] ?? 0) + offset]));
  return createGame(s, seed, {
    a: { nickname: "A", profile: profile({ name: "Aria Left", values: near(-0.2), ...a }) },
    b: { nickname: "B", profile: profile({ name: "Boris Right", values: near(0.2), ...b }) },
  });
}

export function action(overrides: Partial<Action> = {}): Action {
  return {
    kind: "statement",
    issue: null,
    stance: null,
    target: null,
    channel: null,
    intensity: 1,
    corruptionSize: null,
    description: "Does something",
    ...overrides,
  };
}

export function turn(actions: Action[], overrides: Partial<TurnInterpretation> = {}): TurnInterpretation {
  return { actions, flipFlop: false, summary: "A turn", ...overrides };
}

export const noEvents: DirectorOutput = { events: [], exposures: [] };
export const noReactions: FocusGroupOutput = { reactions: [] };

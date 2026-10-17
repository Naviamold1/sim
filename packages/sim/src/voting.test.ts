import { describe, expect, it } from "vitest";
import { ScenarioSchema } from "@pb/scenarios";
import { effectiveSalience, electorate, segmentOutcomes } from "./electorate";
import { runElection } from "./election";
import { createRng } from "./rng";
import { newGame, scenario } from "./testUtil";
import { largestRemainder, normalizeSalience } from "./util";
import { expectedShare, runPoll } from "./voting";

describe("seeded randomness and normalization", () => {
  it("repeats streams, keeps purposes independent and returns finite Gaussian noise", () => {
    const first = createRng("seed", "test");
    const second = createRng("seed", "test");
    const other = createRng("seed", "other");
    const draws = Array.from({ length: 100 }, () => first.next());
    expect(draws).toEqual(Array.from({ length: 100 }, () => second.next()));
    expect(draws).not.toEqual(Array.from({ length: 100 }, () => other.next()));
    expect(draws.every((value) => value >= 0 && value < 1)).toBe(true);
    expect(Array.from({ length: 100 }, () => first.gaussian()).every(Number.isFinite)).toBe(true);
    expect(first.weighted([0, 0])).toBe(-1);
    expect(first.weighted([0, 1, 0])).toBe(1);
  });

  it("apportions every voter or seat, with stable ties and zero-weight handling", () => {
    expect(largestRemainder([0.4, 0.6], 7)).toEqual([3, 4]);
    expect(largestRemainder([1, 1, 1], 2)).toEqual([1, 1, 0]);
    expect(largestRemainder([0, 0], 3)).toEqual([2, 1]);
    expect(largestRemainder([0.1, 0.2, 0.7], 4_001).reduce((sum, value) => sum + value, 0)).toBe(4_001);
  });

  it("normalizes salience, including empty, negative and non-finite input", () => {
    const values = { economy: -1, immigration: Number.NaN, environment: Infinity };
    normalizeSalience(values);
    expect(Object.values(values)).toEqual([1 / 3, 1 / 3, 1 / 3]);
    normalizeSalience(values);
    expect(Object.values(values).reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 12);
    expect(() => normalizeSalience({})).not.toThrow();
    expect(effectiveSalience({ economy: 0.4, environment: 0.6 }, { economy: 0.6 }, ["economy", "environment"]))
      .toEqual([0.625, 0.37499999999999994]);
    expect(effectiveSalience({ economy: 0.4 }, { economy: -10 }, ["economy", "environment"]))
      .toEqual([0.5, 0.5]);
  });
});

describe("voting and polls", () => {
  it("identical candidates split expected votes equally", () => {
    const state = newGame();
    state.candidates.b = { ...structuredClone(state.candidates.a), side: "b" };
    expect(expectedShare(state, scenario)).toBeCloseTo(0.5, 12);
    expect(segmentOutcomes(state, scenario).every((outcome) => outcome.pA === 0.5)).toBe(true);
  });

  it("trust, credibility, affinity and visibility improve support", () => {
    for (const stat of ["trust", "credibility"] as const) {
      const state = newGame();
      const before = expectedShare(state, scenario);
      state.candidates.a[stat] = 1;
      expect(expectedShare(state, scenario)).toBeGreaterThan(before);
    }
    const state = newGame();
    const before = expectedShare(state, scenario);
    for (const segment of Object.values(state.segments)) segment.affinity.a = 0.5;
    expect(expectedShare(state, scenario)).toBeGreaterThan(before);
    const after = expectedShare(state, scenario);
    for (const region of Object.keys(state.candidates.a.visibility)) state.candidates.a.visibility[region] = 1;
    expect(expectedShare(state, scenario)).toBeGreaterThan(after);
  });

  it("closer positions improve choice and higher engagement improves turnout", () => {
    const state = newGame();
    for (const segment of Object.values(state.segments)) {
      for (const issue of scenario.issues) segment.positions[issue.id] = 0;
    }
    for (const issue of scenario.issues) {
      state.candidates.a.positions[issue.id] = 0;
      state.candidates.b.positions[issue.id] = 1;
    }
    expect(expectedShare(state, scenario)).toBeGreaterThan(0.99);
    const before = segmentOutcomes(state, scenario);
    for (const segment of Object.values(state.segments)) segment.engagement = 1;
    const after = segmentOutcomes(state, scenario);
    after.forEach((outcome, index) => expect(outcome.pVote).toBeGreaterThan(before[index]?.pVote ?? 0));
  });

  it("builds exactly the configured electorate and stable polls without consuming election randomness", () => {
    const state = newGame();
    const original = structuredClone(state);
    const voters = electorate(state, scenario);
    expect(voters.count).toBe(4_000);
    expect(Array.from(voters.regionOf).filter((region) => region === 0)).toHaveLength(1_600);
    expect(Array.from(voters.pVote).every((value) => value >= 0 && value <= 1)).toBe(true);
    expect(Array.from(voters.pA).every((value) => value >= 0 && value <= 1)).toBe(true);
    const election = runElection(state, scenario);
    const poll = runPoll(state, scenario);
    expect(runPoll(state, scenario)).toEqual(poll);
    expect(runElection(state, scenario)).toEqual(election);
    expect(poll.national.a + poll.national.b).toBe(1);
    expect(Object.keys(poll.regions)).toEqual(["north", "south"]);
    expect(state).toEqual(original);
    expect(runPoll(newGame(scenario, "different"), scenario)).not.toEqual(poll);
  });
});

describe("electoral systems", () => {
  function fixture(system: "fptp-regions" | "proportional") {
    const definition = structuredClone(scenario);
    definition.electoralSystem = system;
    definition.map.regions[0]!.seats = 9;
    definition.map.regions[1]!.seats = 1;
    definition.tuning = { ...definition.tuning, voterNoise: 0, turnoutA: 0, turnoutB: 0, turnoutT: -1_000, tau: 0.001 };
    const parsed = ScenarioSchema.parse(definition);
    const state = newGame(parsed);
    for (const issue of parsed.issues) {
      state.candidates.a.positions[issue.id] = -1;
      state.candidates.b.positions[issue.id] = 1;
      for (const segment of parsed.segments) state.segments[segment.id]!.positions[issue.id] = segment.regionId === "north" ? -1 : 1;
    }
    return { state, scenario: parsed };
  }

  it("FPTP awards all regional seats, even when the national popular vote loses", () => {
    const { state, scenario: definition } = fixture("fptp-regions");
    const result = runElection(state, definition);
    expect(result.national.votes).toEqual({ a: 1_600, b: 2_400 });
    expect(result.seats).toEqual({ a: 9, b: 1 });
    expect(result.winner).toBe("a");
    expect(result.national.turnout).toBe(1);
    expect(result.regions.map((region) => region.seats)).toEqual([{ a: 9, b: 0 }, { a: 0, b: 1 }]);
  });

  it("proportional seats follow national votes and reconcile regional reveal totals", () => {
    const { state, scenario: definition } = fixture("proportional");
    const result = runElection(state, definition);
    expect(result.national.votes).toEqual({ a: 1_600, b: 2_400 });
    expect(result.seats).toEqual({ a: 4, b: 6 });
    expect(result.winner).toBe("b");
    expect(result.regions.reduce((sum, region) => sum + region.seats.a, 0)).toBe(result.seats.a);
    expect(result.regions.reduce((sum, region) => sum + region.seats.b, 0)).toBe(result.seats.b);
    result.regions.forEach((region, index) => expect(region.seats.a + region.seats.b).toBe(definition.map.regions[index]?.seats));
  });

  it.each(["fptp-regions", "proportional"] as const)("handles zero turnout and ties deterministically in %s", (system) => {
    const { state, scenario: definition } = fixture(system);
    const empty = ScenarioSchema.parse({ ...definition, tuning: { ...definition.tuning, turnoutT: 1_000 } });
    const result = runElection(state, empty);
    expect(result.national.votes).toEqual({ a: 0, b: 0 });
    expect(result.national.share).toEqual({ a: 0.5, b: 0.5 });
    expect(result.national.turnout).toBe(0);
    expect(result.seats.a + result.seats.b).toBe(10);
    expect(result).toEqual(runElection(state, empty));
  });
});

import { describe, expect, it } from "vitest";
import { getScenario, ScenarioSchema, type Scenario } from "@pb/scenarios";
import { rollCorruption } from "./corruption";
import { runElection } from "./election";
import { selectPersonas } from "./personas";
import { action, newGame, noEvents, noReactions, scenario, turn } from "./testUtil";
import type { CorruptionSize, FocusGroupOutput } from "./inputs";
import { YEARS, type GameState } from "./types";
import { expectedShare } from "./voting";
import { beginYear, finishYear } from "./year";

function resolve(state: GameState, definition: Scenario = scenario) {
  const begun = beginYear(state, definition, { turns: { a: null, b: null }, director: noEvents });
  return finishYear(begun.state, definition, begun.pending, noReactions).state;
}

describe("corruption risk", () => {
  it("is deterministic, grows with size and time, and excludes exposed/future cases", () => {
    const state = newGame();
    state.year = 4;
    const scandal = { id: "same-case", size: "small" as CorruptionSize, yearTaken: 4, exposed: false, yearExposed: null, description: "A case" };
    state.candidates.a.corruptionCases.push(scandal);
    const hits = (size: CorruptionSize, yearTaken: number) => {
      scandal.size = size;
      scandal.yearTaken = yearTaken;
      return Array.from({ length: 1_000 }, (_value, index) => {
        state.seed = `risk-${index}`;
        const result = rollCorruption(state, scenario);
        expect(rollCorruption(state, scenario)).toEqual(result);
        return result.length;
      }).reduce((sum, value) => sum + value, 0);
    };
    const small = hits("small", 4);
    const medium = hits("medium", 4);
    const big = hits("big", 4);
    const older = hits("big", 1);
    expect(small).toBeGreaterThan(50);
    expect(medium).toBeGreaterThan(small);
    expect(big).toBeGreaterThan(medium);
    expect(older).toBeGreaterThan(big);
    scandal.exposed = true;
    expect(rollCorruption(state, scenario)).toEqual([]);
    scandal.exposed = false;
    scandal.yearTaken = 5;
    expect(rollCorruption(state, scenario)).toEqual([]);
  });

  it("rolls new cases after actions, including the final turn, using fallback narration", () => {
    const definition = ScenarioSchema.parse({ ...scenario, tuning: { ...scenario.tuning, corruptionRisk: { small: 1, medium: 1, big: 1 } } });
    let state = newGame(definition);
    for (let year = 1; year <= YEARS; year++) state = resolve(state, definition);
    const before = structuredClone(state);
    const speculative = rollCorruption(state, definition);
    expect(speculative).toEqual([]);
    const begun = beginYear(state, definition, { turns: { a: turn([action({ kind: "corruption", corruptionSize: "big", description: "Secret contracts" })]), b: null }, director: noEvents });
    expect(begun.pending.exposures).toHaveLength(1);
    expect(begun.pending.final).toBe(true);
    expect(begun.pending.turns.a?.year).toBe(4);
    expect(begun.pending.events[0]).toMatchObject({ kind: "exposure", side: "a", year: 5 });
    expect(begun.pending.events[0]?.headline).toContain("corruption scandal");
    expect(begun.state.candidates.a.trust).toBeCloseTo(state.candidates.a.trust - 0.22);
    expect(begun.state.candidates.a.corruptionCases[0]).toMatchObject({ exposed: true, yearTaken: 4, yearExposed: 5 });
    expect(rollCorruption(begun.state, definition)).toEqual([]);
    const finished = finishYear(begun.state, definition, begun.pending, noReactions);
    expect(finished.state.candidates.a.funds).toBe(state.candidates.a.funds + 90);
    expect(finished.state.year).toBe(5);
    expect(state).toEqual(before);
  });

  it("preserves speculative rolls for existing cases and applies narrated exposure exactly once", () => {
    const definition = ScenarioSchema.parse({ ...scenario, tuning: { ...scenario.tuning, corruptionRisk: { small: 1, medium: 1, big: 1 } } });
    let state = resolve(newGame(definition), definition);
    state.candidates.a.corruptionCases.push({ id: "existing", size: "small", yearTaken: 1, exposed: false, yearExposed: null, description: "Old case" });
    const expected = rollCorruption(state, definition);
    const begun = beginYear(state, definition, { turns: { a: null, b: null }, director: { events: [], exposures: [
      { caseId: "existing", headline: "Verified scandal", description: "A reported case" },
      { caseId: "invented", headline: "Invented scandal", description: "Must not appear" },
    ] } });
    expect(begun.pending.exposures).toEqual(expected);
    expect(begun.pending.events).toHaveLength(1);
    expect(begun.pending.events[0]?.headline).toBe("Verified scandal");
    state = finishYear(begun.state, definition, begun.pending, noReactions).state;
    const after = resolve(state, definition);
    expect(after.candidates.a.trust).toBe(state.candidates.a.trust);
    expect(after.world.events.filter((event) => event.kind === "exposure")).toHaveLength(1);
  });
});

describe("year pipeline", () => {
  it("runs an opening resolution plus four turns without mutating inputs, deterministically", () => {
    function play(seed: string) {
      const definition = getScenario("uk");
      let state = newGame(definition, seed);
      for (let resolution = 1; resolution <= YEARS + 1; resolution++) {
        const before = structuredClone(state);
        const beforeShare = expectedShare(state, definition);
        const director = { events: [{ templateId: "cost-of-living", severity: 1, regions: [], headline: "Bills rise", description: "Costs increase", custom: null }], exposures: [] };
        const turns = { a: resolution === 1 ? null : turn([action({ kind: "promise", issue: "housing", stance: -0.8 })]), b: resolution === 1 ? null : turn([action({ kind: "rally", target: "north-east" })]) };
        const begun = beginYear(state, definition, { turns, director });
        const personas = selectPersonas(begun.state, definition);
        expect(personas.length).toBeGreaterThanOrEqual(8);
        expect(personas.length).toBeLessThanOrEqual(16);
        expect(new Set(personas.map((persona) => persona.regionId)).size).toBe(12);
        expect(new Set(personas.map((persona) => persona.classId)).size).toBe(3);
        expect(selectPersonas(begun.state, definition)).toEqual(personas);
        const focusGroup: FocusGroupOutput = { reactions: personas.map((persona) => ({ personaId: persona.id, affinityDelta: { a: 0.02, b: -0.01 }, engagementDelta: 0.01, salienceShift: { issue: "housing", delta: 0.02 }, quote: "Housing matters to me." })) };
        const intermediate = structuredClone(begun.state);
        const finished = finishYear(begun.state, definition, begun.pending, focusGroup);
        expect(begun.state).toEqual(intermediate);
        expect(state).toEqual(before);
        const previous = before.polls.at(-1)?.national.a ?? beforeShare;
        const explained = finished.recap.breakdown.reduce((sum, contribution) => {
          expect(contribution.delta.b).toBe(-contribution.delta.a);
          return sum + contribution.delta.a;
        }, 0);
        expect(explained).toBeCloseTo(100 * (finished.recap.poll.national.a - previous), 10);
        const formulaEffects = finished.recap.breakdown.filter((entry) => entry.source !== "noise").reduce((sum, entry) => sum + entry.delta.a, 0);
        expect(formulaEffects).toBeCloseTo(100 * (expectedShare(finished.state, definition) - beforeShare), 10);
        expect(finished.recap.quotes.length).toBe(personas.length);
        state = finished.state;
        expect(state.year).toBe(resolution);
        expect(state.polls).toHaveLength(resolution);
        expect(state.recaps).toHaveLength(resolution);
        for (const segment of Object.values(state.segments)) {
          expect(Object.values(segment.salience).reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 10);
          expect(Object.values(segment.positions).every((value) => value >= -1 && value <= 1)).toBe(true);
          expect(segment.engagement).toBeGreaterThanOrEqual(0);
          expect(segment.engagement).toBeLessThanOrEqual(1);
          expect(Math.abs(segment.affinity.a)).toBeLessThanOrEqual(1);
          expect(Math.abs(segment.affinity.b)).toBeLessThanOrEqual(1);
        }
      }
      expect(state.candidates.a.history.map((record) => record.year)).toEqual([1, 2, 3, 4]);
      expect(state.candidates.a.funds).toBe(200);
      expect(state.candidates.b.funds).toBe(176);
      const result = runElection(state, definition);
      expect(result.regions).toHaveLength(12);
      expect(result.seats.a + result.seats.b).toBe(100);
      return { state, result };
    }
    expect(play("replay-seed")).toEqual(play("replay-seed"));
  });

  it("requires matching scenarios, the opening year without turns, and sequential completion", () => {
    const state = newGame();
    expect(() => beginYear(state, getScenario("uk"), { turns: { a: null, b: null }, director: noEvents })).toThrow("Scenario");
    expect(() => beginYear(state, scenario, { turns: { a: turn([]), b: null }, director: noEvents })).toThrow("Opening");
    const begun = beginYear(state, scenario, { turns: { a: null, b: null }, director: noEvents });
    expect(() => finishYear(begun.state, scenario, { ...begun.pending, year: 3 }, noReactions)).toThrow("Pending");
    const finished = finishYear(begun.state, scenario, begun.pending, noReactions);
    expect(() => finishYear(finished.state, scenario, begun.pending, noReactions)).toThrow("Pending");
    let ended = finished.state;
    for (let year = 2; year <= YEARS + 1; year++) ended = resolve(ended);
    expect(() => beginYear(ended, scenario, { turns: { a: null, b: null }, director: noEvents })).toThrow("ended");
  });
});

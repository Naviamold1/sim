import { describe, expect, it } from "vitest";
import { ActionSchema, CandidateProfileSchema, TurnInterpretationSchema, type Action } from "./inputs";
import { applyTurn } from "./actions";
import { Ledger, type Working } from "./ledger";
import { action, newGame, scenario, turn } from "./testUtil";
import { createGame } from "./game";
import { profile } from "./testUtil";

function working(): Working {
  const state = newGame();
  return { state, scenario, ledger: new Ledger(state, scenario) };
}

describe("profiles", () => {
  it("clamps AI values, ignores unknown/inherited issues and falls back to a known background", () => {
    const parsed = profile({ background: "unknown", trust: 1e9, charisma: -1e9, strengths: ["a", "b", "c", "d"],
      positions: [{ issue: "economy", value: 100 }, { issue: "missing", value: -1 }, { issue: "constructor", value: 1 }] });
    const state = createGame(scenario, "seed", { a: { nickname: " A ", profile: parsed }, b: { nickname: "B", profile: profile() } });
    const candidate = state.candidates.a;
    expect(candidate.trust).toBe(0.6);
    expect(candidate.charisma).toBe(0.4);
    expect(candidate.background).toBe("worker");
    expect(candidate.positions).toEqual({ economy: 1, immigration: 0, environment: 0 });
    expect(candidate.nickname).toBe("A");
    expect(candidate.strengths).toHaveLength(3);
    expect(candidate.funds).toBe(100);
    expect(candidate.visibility).toEqual(state.candidates.b.visibility);
    expect(Object.values(state.segments).every((segment) => segment.affinity.a >= -1 && segment.affinity.a <= 1)).toBe(true);
  });

  it("applies only scenario-authored background advantages", () => {
    const state = newGame(scenario, "seed", { background: "billionaire" }, { background: "worker" });
    expect(state.candidates.a.funds - state.candidates.b.funds).toBe(60);
    expect(state.segments["north-working-young"]?.affinity).toEqual({ a: -0.08, b: 0.05 });
  });

  it("schemas reject unbounded profiles and actions before reaching the sim", () => {
    expect(CandidateProfileSchema.safeParse(profile({ trust: 2 })).success).toBe(false);
    for (const changes of [{ intensity: 4 }, { intensity: 0 }, { stance: 2 }, { kind: "win" }, { corruptionSize: "huge" }]) {
      expect(ActionSchema.safeParse({ ...action(), ...changes }).success).toBe(false);
    }
    expect(TurnInterpretationSchema.safeParse(turn(Array.from({ length: 7 }, () => action()))).success).toBe(false);
  });
});

describe("action budgets and effects", () => {
  it("enforces five total points and records over-budget actions", () => {
    const work = working();
    const result = applyTurn(work, "a", turn(Array.from({ length: 10 }, () => action({ kind: "attack", intensity: 3 }))), 1);
    expect(result.applied.map((item) => item.intensity)).toEqual([3, 2]);
    expect(result.dropped).toHaveLength(8);
    expect(result.dropped.every((item) => item.reason === "budget")).toBe(true);
    expect(result.applied.reduce((sum, item) => sum + item.intensity, 0)).toBe(5);
    expect(work.state.candidates.a.trust).toBeGreaterThanOrEqual(0);
    expect(work.state.candidates.b.trust).toBeGreaterThanOrEqual(0);
  });

  it("scales unaffordable media, never overspends, and spends only applied points", () => {
    const work = working();
    work.state.candidates.a.funds = 25;
    const result = applyTurn(work, "a", turn([
      action({ kind: "media", channel: "tv", intensity: 3 }),
      action({ kind: "rally", intensity: 2 }),
      action({ kind: "attack", intensity: 3 }),
    ]), 1);
    expect(result.applied.map((item) => [item.kind, item.intensity, item.cost])).toEqual([["media", 2, 24], ["attack", 3, 0]]);
    expect(result.dropped[0]?.reason).toBe("funds");
    expect(work.state.candidates.a.funds).toBe(1);
  });

  it("rejects unknown ids, kinds, sizes and non-finite intensity without consuming funds or points", () => {
    const work = working();
    const invalid = [
      action({ kind: "reform", issue: "economy", stance: Infinity }),
      action({ kind: "reform", issue: "unknown", stance: 0 }),
      action({ kind: "rally", target: "missing" }),
      action({ kind: "attack", intensity: Number.NaN }),
      { ...action(), kind: "win" } as unknown as Action,
      { ...action({ kind: "corruption" }), corruptionSize: "huge" } as unknown as Action,
      { ...action({ kind: "media" }), channel: "magic" } as unknown as Action,
    ];
    const result = applyTurn(work, "a", turn([...invalid, action({ kind: "attack", intensity: 3 })]), 1);
    expect(result.dropped).toHaveLength(invalid.length);
    expect(result.dropped.every((item) => item.reason === "invalid")).toBe(true);
    expect(result.applied).toHaveLength(1);
    expect(work.state.candidates.a.funds).toBe(100);
  });

  it("caps extreme valid intensities and stances and advances policies by only 0.1 per point", () => {
    const work = working();
    work.state.candidates.a.positions.economy = 0;
    const result = applyTurn(work, "a", turn([action({ kind: "promise", issue: "economy", stance: 1e9, intensity: 1e9 })]), 1);
    expect(result.applied[0]?.intensity).toBe(3);
    expect(work.state.candidates.a.positions.economy).toBeCloseTo(0.3);
    expect(work.state.candidates.a.promises[0]?.stance).toBe(1);
    expect(work.state.candidates.a.promises[0]?.year).toBe(1);
    for (const segment of Object.values(work.state.segments)) {
      expect(Object.values(segment.salience).reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 12);
    }
  });

  it("penalizes flip-flops and breaks a contradicted promise only once", () => {
    const work = working();
    applyTurn(work, "a", turn([action({ kind: "promise", issue: "economy", stance: -1 })]), 1);
    applyTurn(work, "a", turn([action({ kind: "statement", issue: "economy", stance: 1 })], { flipFlop: true }), 2);
    expect(work.state.candidates.a.promises[0]?.broken).toBe(true);
    expect(work.state.candidates.a.credibility).toBeCloseTo(0.8 - 0.06 - 0.08);
    applyTurn(work, "a", turn([action({ kind: "statement", issue: "economy", stance: 1 })]), 3);
    expect(work.state.candidates.a.credibility).toBeCloseTo(0.8 - 0.06 - 0.08);
  });

  it("rallies reach one region; social media is stronger among young segments; TV is national", () => {
    const rally = working();
    const original = structuredClone(rally.state);
    applyTurn(rally, "a", turn([action({ kind: "rally", target: "north-working-young" })]), 1);
    expect(rally.state.candidates.a.visibility.north).toBeGreaterThan(original.candidates.a.visibility.north ?? 0);
    expect(rally.state.candidates.a.visibility.south).toBe(original.candidates.a.visibility.south);
    expect(rally.state.segments["south-working-young"]).toEqual(original.segments["south-working-young"]);
    const social = working();
    applyTurn(social, "a", turn([action({ kind: "media", channel: "social", target: "north" })]), 1);
    expect(social.state.segments["north-working-young"]!.affinity.a).toBeGreaterThan(social.state.segments["north-working-old"]!.affinity.a);
    const tv = working();
    applyTurn(tv, "a", turn([action({ kind: "media", channel: "tv", target: "north" })]), 1);
    expect(tv.state.candidates.a.visibility.south).toBeGreaterThan(0.3);
  });

  it("corruption yields size-scaled funds, unique cases and private ledger entries", () => {
    const gains = ["small", "medium", "big"].map((size) => {
      const work = working();
      const corruptionSize = size as "small" | "medium" | "big";
      const result = applyTurn(work, "a", turn([action({ kind: "corruption", corruptionSize }), action({ kind: "corruption", corruptionSize })]), 4);
      expect(result.applied.every((item) => item.secret)).toBe(true);
      expect(work.ledger.entries.every((entry) => entry.secret)).toBe(true);
      expect(new Set(work.state.candidates.a.corruptionCases.map((item) => item.id)).size).toBe(2);
      expect(work.state.candidates.a.corruptionCases.every((item) => item.yearTaken === 4 && !item.exposed)).toBe(true);
      return work.state.candidates.a.funds - 100;
    });
    expect(gains).toEqual([40, 90, 180]);
  });
});

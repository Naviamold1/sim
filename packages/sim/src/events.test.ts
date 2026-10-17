import { describe, expect, it } from "vitest";
import { applyDirectorEvents, applyExposures, eventIdGenerator } from "./events";
import { DirectorOutputSchema, FocusGroupOutputSchema, type DirectorEvent } from "./inputs";
import { Ledger, type Working } from "./ledger";
import { selectPersonas } from "./personas";
import { applyDrift, applyReactions } from "./reactions";
import { newGame, scenario } from "./testUtil";

function working(): Working {
  const state = newGame();
  return { state, scenario, ledger: new Ledger(state, scenario) };
}

const event = (overrides: Partial<DirectorEvent> = {}): DirectorEvent => ({
  templateId: "flood", severity: 1, regions: [], headline: "", description: "", custom: null, ...overrides,
});

describe("director events and exposure", () => {
  it("enforces template target filters, severity and per-game use limits", () => {
    const work = working();
    const nextId = eventIdGenerator(1);
    const originalSouth = structuredClone(work.state.segments["south-working-young"]);
    const first = applyDirectorEvents(work, 1, [event({ regions: ["south", "missing"], severity: 100 })], nextId);
    expect(first[0]).toMatchObject({ regions: ["north"], severity: 3, headline: "Floods hit North" });
    expect(work.state.segments["south-working-young"]).toEqual(originalSouth);
    expect(work.state.world.templateUses.flood).toBe(1);
    expect(applyDirectorEvents(work, 2, [event(), event(), event()], nextId)).toHaveLength(1);
    expect(work.state.world.templateUses.flood).toBe(2);
    expect(applyDirectorEvents(work, 3, [event()], nextId)).toEqual([]);
    expect(applyDirectorEvents(work, 3, [event({ templateId: "missing" })], nextId)).toEqual([]);
  });

  it("applies national templates nationally and limits director events to two", () => {
    const work = working();
    const applied = applyDirectorEvents(work, 1, [event({ templateId: "crash", regions: ["north"] }), event({ templateId: "pandemic" }), event()], eventIdGenerator(1));
    expect(applied).toHaveLength(2);
    expect(applied.every((item) => item.regions.length === 0)).toBe(true);
    expect(work.state.world.salienceModifiers.economy).toBeCloseTo(0.15);
    expect(work.state.world.templateUses.pandemic).toBe(1);
    expect(applyDirectorEvents(work, 2, [event({ templateId: "pandemic" })], eventIdGenerator(2))).toEqual([]);
  });

  it("caps custom vector components after duplicate aggregation and ignores unknown issues", () => {
    const work = working();
    const before = work.state.segments["north-working-young"]!.positions.economy ?? 0;
    const applied = applyDirectorEvents(work, 1, [event({ templateId: null, severity: 3, regions: ["north", "north", "missing"], custom: {
      salience: [{ issue: "economy", delta: 999 }, { issue: "economy", delta: 999 }],
      positions: [{ issue: "economy", delta: 999 }, { issue: "economy", delta: 999 }, { issue: "missing", delta: 999 }],
      engagement: 999,
    } })], eventIdGenerator(1));
    expect(applied[0]?.regions).toEqual(["north"]);
    expect(work.state.segments["north-working-young"]!.positions.economy).toBeCloseTo(before + 0.15);
    expect(work.state.segments["north-working-young"]!.engagement).toBeCloseTo(0.6);
    expect(work.state.segments["south-working-young"]!.engagement).toBe(0.4);
    for (const segment of Object.values(work.state.segments)) {
      expect(Object.values(segment.salience).reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 12);
      expect(segment.positions).not.toHaveProperty("missing");
    }
  });

  it("does not trust unknown exposure cases or director attempts to invent one", () => {
    const work = working();
    const before = structuredClone(work.state);
    expect(applyExposures(work, 2, [{ side: "a", caseId: "fake", size: "big", yearTaken: 1, description: "fake" }],
      [{ caseId: "fake", headline: "Fabricated scandal", description: "" }], eventIdGenerator(2))).toEqual([]);
    expect(work.state).toEqual(before);
  });

  it("does not expand an invalid custom target into a national event", () => {
    const work = working();
    const before = structuredClone(work.state);
    const applied = applyDirectorEvents(work, 1, [event({ templateId: null, regions: ["missing"], custom: {
      salience: [], positions: [{ issue: "economy", delta: 0.15 }], engagement: 0.15,
    } })], eventIdGenerator(1));
    expect(applied).toEqual([]);
    expect(work.state).toEqual(before);
  });

  it("schemas reject unbounded director and focus group values", () => {
    expect(DirectorOutputSchema.safeParse({ events: [event({ severity: 4 })], exposures: [] }).success).toBe(false);
    expect(FocusGroupOutputSchema.safeParse({ reactions: [{ personaId: "x", affinityDelta: { a: 1, b: 0 }, engagementDelta: 0, salienceShift: null, quote: "" }] }).success).toBe(false);
  });
});

describe("focus group and drift", () => {
  it("applies each known persona once, clamps deltas and spills over only across regions of the same class", () => {
    const work = working();
    const personas = selectPersonas(work.state, scenario);
    const reaction = { personaId: "north-working-young", affinityDelta: { a: 999, b: -999 }, engagementDelta: 999,
      salienceShift: { issue: "economy", delta: 999 }, quote: "  I have an opinion.  " };
    const quotes = applyReactions(work, personas, { reactions: [reaction, reaction, { ...reaction, personaId: "missing" }] });
    expect(quotes).toHaveLength(1);
    expect(quotes[0]?.quote).toBe("I have an opinion.");
    expect(work.state.segments["north-working-young"]!.affinity).toEqual({ a: 0.2, b: -0.2 });
    expect(work.state.segments["south-working-young"]!.affinity.a).toBeCloseTo(0.06);
    expect(work.state.segments["north-working-old"]!.affinity.a).toBe(0);
    expect(work.state.segments["south-middle-young"]!.affinity.a).toBe(0);
    expect(work.state.segments["north-working-young"]!.engagement).toBeCloseTo(0.55);
    expect(work.state.segments["south-working-young"]!.engagement).toBeCloseTo(0.43);
    expect(Object.values(work.state.segments["north-working-young"]!.salience).reduce((sum, value) => sum + value, 0)).toBeCloseTo(1);
  });

  it("drifts unsampled segments toward anchors and fades world salience and visibility", () => {
    const work = working();
    const persona = selectPersonas(work.state, scenario).find((item) => item.id === "north-working-young")!;
    work.state.segments[persona.id]!.affinity.a = 0.8;
    work.state.world.salienceModifiers.economy = 0.2;
    work.state.candidates.a.visibility.north = 1;
    applyDrift(work, [persona]);
    expect(work.state.segments[persona.id]!.affinity.a).toBe(0.8);
    expect(work.state.segments["south-working-young"]!.affinity.a).toBeCloseTo(0.12);
    expect(work.state.segments["south-middle-young"]!.affinity.a).toBe(0);
    expect(work.state.world.salienceModifiers.economy).toBe(0.1);
    expect(work.state.candidates.a.visibility.north).toBeCloseTo(0.93);
  });
});

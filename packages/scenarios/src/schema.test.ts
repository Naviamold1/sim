import { describe, expect, it } from "vitest";
import { getScenario, isScenarioId, scenarioIds, scenarios } from "./index";
import { ScenarioSchema, TuningSchema, type Scenario } from "./schema";
import { testScenario } from "./testing";
import { defaultTuning, resolveTuning } from "./tuning";

describe("scenario registry", () => {
  it.each(scenarioIds)("validates %s with matching registry identity and complete data", (id) => {
    const scenario = getScenario(id);
    expect(ScenarioSchema.parse(scenario)).toEqual(scenario);
    expect(scenario.meta.id).toBe(id);
    expect(scenario).not.toBe(testScenario);
    expect(scenario.map.regions).toHaveLength(12);
    expect(scenario.segments).toHaveLength(108);
    expect(scenario.map.regions.reduce((sum, region) => sum + region.seats, 0)).toBe(100);
    expect(scenario.events.templates.some((event) => event.rarity === "rare")).toBe(true);
    for (const region of scenario.map.regions) {
      for (const socialClass of scenario.classes) {
        for (const age of scenario.ages) expect(scenario.segments.some((segment) =>
          segment.regionId === region.id && segment.classId === socialClass.id && segment.ageId === age.id)).toBe(true);
      }
    }
    expect(TuningSchema.parse(resolveTuning(scenario))).toEqual(resolveTuning(scenario));
  });

  it("rejects inherited keys when looking up scenarios", () => {
    expect(isScenarioId("uk")).toBe(true);
    expect(isScenarioId("constructor")).toBe(false);
    expect(isScenarioId("test")).toBe(false);
    expect(Object.keys(scenarios)).toEqual(scenarioIds);
  });

  it("resolves defaults and scenario overrides without mutating either", () => {
    expect(resolveTuning(testScenario)).toEqual({ ...defaultTuning, voterCount: 4_000, pollSample: 500 });
    expect(defaultTuning.voterCount).toBe(20_000);
  });
});

describe("scenario validation", () => {
  const invalid: Array<[string, (scenario: Scenario) => void]> = [
    ["duplicate ids", (scenario) => { scenario.issues[1]!.id = scenario.issues[0]!.id; }],
    ["unknown region", (scenario) => { scenario.segments[0]!.regionId = "missing"; }],
    ["unknown class", (scenario) => { scenario.segments[0]!.classId = "missing"; }],
    ["unknown age", (scenario) => { scenario.segments[0]!.ageId = "missing"; }],
    ["missing position", (scenario) => { delete scenario.segments[0]!.positions.economy; }],
    ["unknown issue", (scenario) => { scenario.segments[0]!.positions.missing = 0; }],
    ["out-of-range position", (scenario) => { scenario.segments[0]!.positions.economy = 5; }],
    ["negative salience", (scenario) => { scenario.segments[0]!.salience.economy = -0.5; }],
    ["unnormalized salience", (scenario) => { scenario.segments[0]!.salience.economy = 1; }],
    ["national shares", (scenario) => { scenario.map.regions[0]!.share = 0.9; }],
    ["segment shares", (scenario) => { scenario.segments[0]!.share = 0.9; }],
    ["regional segment shares", (scenario) => { scenario.segments[0]!.regionId = "south"; }],
    ["event issue references", (scenario) => { scenario.events.templates[0]!.impacts.positions.missing = 0.1; }],
    ["event region references", (scenario) => { scenario.events.templates[0]!.target.regions = ["missing"]; }],
    ["inverted target range", (scenario) => { scenario.events.templates[0]!.target.minUrban = 0.9; }],
    ["ineligible template", (scenario) => { scenario.events.templates[0]!.target.maxUrban = 0.1; }],
    ["background references", (scenario) => { scenario.backgrounds[0]!.modifiers.affinity[0]!.classIds = ["missing"]; }],
    ["inverted age range", (scenario) => { scenario.ages[0]!.max = 10; }],
    ["inverted tuning bands", (scenario) => { scenario.tuning.trustBand = [0.7, 0.2]; }],
    ["decreasing corruption risk", (scenario) => { scenario.tuning.corruptionRisk = { small: 0.9, medium: 0.2, big: 0.1 }; }],
    ["negative corruption funds", (scenario) => { scenario.tuning.corruptionFunds = { small: -1, medium: 0, big: 0 }; }],
    ["region/segment collision", (scenario) => { scenario.segments[0]!.id = "north"; }],
    ["reserved ids", (scenario) => { scenario.meta.id = "constructor"; }],
    ["non-finite values", (scenario) => { scenario.segments[0]!.engagement = Number.NaN; }],
  ];
  it.each(invalid)("rejects %s", (_name, mutate) => {
    const scenario = structuredClone(testScenario);
    mutate(scenario);
    expect(ScenarioSchema.safeParse(scenario).success).toBe(false);
  });
});

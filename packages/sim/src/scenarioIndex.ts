import { resolveTuning } from "@pb/scenarios";
import type { AgeGroup, Background, EventTemplate, Issue, Region, Scenario, Segment, SocialClass, Tuning } from "@pb/scenarios";

/** Lookup tables over a scenario, built once per scenario object. */
export interface ScenarioIndex {
  tuning: Tuning;
  issueIds: string[];
  issueById: Map<string, Issue>;
  regionById: Map<string, Region>;
  /** region id -> position in `scenario.map.regions` */
  regionIndex: Map<string, number>;
  segmentById: Map<string, Segment>;
  segmentsByRegion: Map<string, Segment[]>;
  classById: Map<string, SocialClass>;
  ageById: Map<string, AgeGroup>;
  backgroundById: Map<string, Background>;
  templateById: Map<string, EventTemplate>;
}

const cache = new WeakMap<Scenario, ScenarioIndex>();

const byId = <T extends { id: string }>(items: readonly T[]): Map<string, T> => new Map(items.map((x) => [x.id, x]));

export function indexScenario(scenario: Scenario): ScenarioIndex {
  const cached = cache.get(scenario);
  if (cached) return cached;
  const segmentsByRegion = new Map<string, Segment[]>(scenario.map.regions.map((r) => [r.id, []]));
  for (const seg of scenario.segments) segmentsByRegion.get(seg.regionId)?.push(seg);
  const index: ScenarioIndex = {
    tuning: resolveTuning(scenario),
    issueIds: scenario.issues.map((i) => i.id),
    issueById: byId(scenario.issues),
    regionById: byId(scenario.map.regions),
    regionIndex: new Map(scenario.map.regions.map((r, i) => [r.id, i])),
    segmentById: byId(scenario.segments),
    segmentsByRegion,
    classById: byId(scenario.classes),
    ageById: byId(scenario.ages),
    backgroundById: byId(scenario.backgrounds),
    templateById: byId(scenario.events.templates),
  };
  cache.set(scenario, index);
  return index;
}

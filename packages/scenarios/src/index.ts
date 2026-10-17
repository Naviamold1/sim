import type { Scenario } from "./schema";
import { uk } from "./uk";

export * from "./schema";
export { defaultTuning, resolveTuning } from "./tuning";
export { defineScenario } from "./define";

/** Scenario registry. Adding a scenario = a new folder + one line here. */
export const scenarios = { uk } as const satisfies Record<string, Scenario>;

export type ScenarioId = keyof typeof scenarios;

export const scenarioIds = Object.keys(scenarios) as ScenarioId[];

export function isScenarioId(id: string): id is ScenarioId {
  return Object.hasOwn(scenarios, id);
}

export function getScenario(id: ScenarioId): Scenario {
  return scenarios[id];
}

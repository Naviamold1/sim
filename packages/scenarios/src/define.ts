import { ScenarioSchema, type Scenario, type ScenarioInput } from "./schema";

/** Validates a scenario at module load so a broken scenario fails fast. */
export function defineScenario(input: ScenarioInput): Scenario {
  return ScenarioSchema.parse(input);
}

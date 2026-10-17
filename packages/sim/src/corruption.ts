import type { Scenario } from "@pb/scenarios";
import { SIDES } from "./inputs";
import { createRng } from "./rng";
import { indexScenario } from "./scenarioIndex";
import type { Exposure, GameState } from "./types";

/**
 * Rolls exposure for every open case, including cases taken in the current turn.
 * Pure and deterministic in (seed, state.year, case id), so the room can call it when a turn
 * starts (to brief the director). `beginYear` preserves those rolls and also rolls newly
 * taken cases after actions; missing director narration uses the simulation's default text.
 */
export function rollCorruption(state: GameState, scenario: Scenario): Exposure[] {
  const { tuning } = indexScenario(scenario);
  const exposures: Exposure[] = [];
  for (const side of SIDES) {
    for (const c of state.candidates[side].corruptionCases) {
      if (c.exposed || c.yearTaken > state.year) continue;
      const p = tuning.corruptionRisk[c.size] + tuning.corruptionRiskPerYear * (state.year - c.yearTaken);
      if (createRng(state.seed, "corruption", state.year, c.id).next() < p) {
        exposures.push({ side, caseId: c.id, size: c.size, yearTaken: c.yearTaken, description: c.description });
      }
    }
  }
  return exposures;
}

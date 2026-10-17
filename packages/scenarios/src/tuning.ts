import type { Scenario, Tuning } from "./schema";

/** Defaults for every scenario. Scenarios override any subset via `tuning`. */
export const defaultTuning: Tuning = {
  alpha: 3,
  beta: 1.5,
  gamma: 2,
  delta: 1,
  tau: 0.35,
  turnoutA: 4,
  turnoutB: 1,
  turnoutT: 2.2,
  voterCount: 20_000,
  voterNoise: 0.15,
  pollSample: 1_000,
  pollNoise: 0.025,
  actionPoints: 5,
  startingFunds: 100,
  yearlyIncome: 25,
  startingVisibility: 0.3,
  corruptionRisk: { small: 0.1, medium: 0.25, big: 0.45 },
  corruptionRiskPerYear: 0.05,
  corruptionFunds: { small: 20, medium: 45, big: 90 },
  corruptionTrustHit: { small: 0.06, medium: 0.12, big: 0.22 },
  costs: { tv: 12, social: 4, rally: 6 },
  spillover: 0.3,
  drift: 0.15,
  trustBand: [0.4, 0.6],
  charismaBand: [0.4, 0.7],
};

export function resolveTuning(scenario: Scenario): Tuning {
  return { ...defaultTuning, ...scenario.tuning };
}

import type { Scenario } from "@pb/scenarios";
import { createRng } from "./rng";
import { indexScenario } from "./scenarioIndex";
import type { GameState } from "./types";
import { clamp01, clampSigned, largestRemainder, sigmoid } from "./util";

/**
 * The voting model. Voters are segment values plus fixed seeded noise, so they are identical
 * every year and only change through segment/candidate state.
 */

export interface Outcome {
  /** Probability the voter turns out. */
  pVote: number;
  /** Probability of choosing candidate a, given that they vote. */
  pA: number;
}

/** Fixed per-voter noise, in scenario segment order. */
interface VoterNoise {
  count: number;
  /** Index into `scenario.segments` per voter. */
  segmentOf: Int32Array;
  /** `count * issueCount` raw position noise. */
  positions: Float64Array;
  engagement: Float64Array;
}

const noiseCache = new WeakMap<Scenario, Map<string, VoterNoise>>();
const MAX_CACHED_PER_SCENARIO = 4;

function voterNoise(seed: string, scenario: Scenario): VoterNoise {
  const { tuning, issueIds } = indexScenario(scenario);
  const key = `${seed}|${tuning.voterCount}`;
  let perScenario = noiseCache.get(scenario);
  if (!perScenario) noiseCache.set(scenario, (perScenario = new Map()));
  const cached = perScenario.get(key);
  if (cached) return cached;

  const k = issueIds.length;
  const counts = largestRemainder(scenario.segments.map((s) => s.share), tuning.voterCount);
  const rng = createRng(seed, "voters");
  const noise: VoterNoise = {
    count: tuning.voterCount,
    segmentOf: new Int32Array(tuning.voterCount),
    positions: new Float64Array(tuning.voterCount * k),
    engagement: new Float64Array(tuning.voterCount),
  };
  let v = 0;
  counts.forEach((n, segIdx) => {
    for (let i = 0; i < n; i++, v++) {
      noise.segmentOf[v] = segIdx;
      for (let j = 0; j < k; j++) noise.positions[v * k + j] = rng.gaussian() * tuning.voterNoise;
      noise.engagement[v] = rng.gaussian() * (tuning.voterNoise / 2);
    }
  });

  if (perScenario.size >= MAX_CACHED_PER_SCENARIO) {
    const oldest = perScenario.keys().next().value;
    if (oldest !== undefined) perScenario.delete(oldest);
  }
  perScenario.set(key, noise);
  return noise;
}

/** Everything about a segment that does not vary between its voters. */
interface PreparedSegment {
  positions: number[];
  salience: number[];
  engagement: number;
  /** Utility terms that do not depend on position distance, per candidate. */
  base: [number, number];
}

/** Effective salience = segment salience + world modifiers, floored at 0 and renormalized. */
export function effectiveSalience(
  salience: Record<string, number>,
  modifiers: Record<string, number>,
  issueIds: readonly string[],
): number[] {
  const raw = issueIds.map((id) => Math.max(0, (salience[id] ?? 0) + (modifiers[id] ?? 0)));
  const total = raw.reduce((a, b) => a + b, 0);
  return raw.map((v) => (total > 0 ? v / total : 1 / raw.length));
}

interface Model {
  alpha: number;
  tau: number;
  turnoutA: number;
  turnoutB: number;
  turnoutT: number;
  issueCount: number;
  segments: PreparedSegment[];
  candidatePositions: [number[], number[]];
}

function prepare(state: GameState, scenario: Scenario): Model {
  const { tuning, issueIds } = indexScenario(scenario);
  const [a, b] = [state.candidates.a, state.candidates.b];
  const segments = scenario.segments.map((def): PreparedSegment => {
    const seg = state.segments[def.id];
    if (!seg) throw new Error(`state has no segment ${def.id}`);
    const base = (c: typeof a, affinity: number): number =>
      tuning.beta * c.trust * c.credibility + tuning.gamma * affinity + tuning.delta * (c.visibility[def.regionId] ?? 0);
    return {
      positions: issueIds.map((id) => seg.positions[id] ?? 0),
      salience: effectiveSalience(seg.salience, state.world.salienceModifiers, issueIds),
      engagement: seg.engagement,
      base: [base(a, seg.affinity.a), base(b, seg.affinity.b)],
    };
  });
  return {
    alpha: tuning.alpha,
    tau: tuning.tau,
    turnoutA: tuning.turnoutA,
    turnoutB: tuning.turnoutB,
    turnoutT: tuning.turnoutT,
    issueCount: issueIds.length,
    segments,
    candidatePositions: [issueIds.map((id) => a.positions[id] ?? 0), issueIds.map((id) => b.positions[id] ?? 0)],
  };
}

/** One voter of `segment`: positions are offset by `noise[offset..]`, engagement by `engagementNoise`. */
function evaluate(m: Model, segment: PreparedSegment, noise: ArrayLike<number>, offset: number, engagementNoise: number): Outcome {
  const [ca, cb] = m.candidatePositions;
  let distA = 0;
  let distB = 0;
  for (let j = 0; j < m.issueCount; j++) {
    const position = clampSigned((segment.positions[j] ?? 0) + (noise[offset + j] ?? 0));
    const salience = segment.salience[j] ?? 0;
    distA += salience * Math.abs(position - (ca[j] ?? 0));
    distB += salience * Math.abs(position - (cb[j] ?? 0));
  }
  const ua = segment.base[0] - m.alpha * distA;
  const ub = segment.base[1] - m.alpha * distB;
  const engagement = clamp01(segment.engagement + engagementNoise);
  return {
    pVote: sigmoid(m.turnoutA * engagement + m.turnoutB * Math.max(ua, ub) - m.turnoutT),
    pA: sigmoid((ua - ub) / m.tau),
  };
}

/** One representative (noise-free) voter per scenario segment, in scenario segment order. */
export function segmentOutcomes(state: GameState, scenario: Scenario): Outcome[] {
  const model = prepare(state, scenario);
  const zeros = new Float64Array(model.issueCount);
  return model.segments.map((seg) => evaluate(model, seg, zeros, 0, 0));
}

export interface Electorate {
  count: number;
  /** Index into `scenario.map.regions` per voter. */
  regionOf: Int32Array;
  pVote: Float64Array;
  pA: Float64Array;
}

/** Turnout and choice probabilities for every voter. */
export function electorate(state: GameState, scenario: Scenario): Electorate {
  const { regionIndex } = indexScenario(scenario);
  const model = prepare(state, scenario);
  const noise = voterNoise(state.seed, scenario);
  const regionOfSegment = scenario.segments.map((s) => regionIndex.get(s.regionId) ?? 0);
  const result: Electorate = {
    count: noise.count,
    regionOf: new Int32Array(noise.count),
    pVote: new Float64Array(noise.count),
    pA: new Float64Array(noise.count),
  };
  for (let v = 0; v < noise.count; v++) {
    const segIdx = noise.segmentOf[v] ?? 0;
    const segment = model.segments[segIdx];
    if (!segment) continue;
    const outcome = evaluate(model, segment, noise.positions, v * model.issueCount, noise.engagement[v] ?? 0);
    result.regionOf[v] = regionOfSegment[segIdx] ?? 0;
    result.pVote[v] = outcome.pVote;
    result.pA[v] = outcome.pA;
  }
  return result;
}

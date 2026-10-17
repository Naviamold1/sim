import type { Scenario } from "@pb/scenarios";
import { electorate, segmentOutcomes } from "./electorate";
import { createRng, type Rng } from "./rng";
import { indexScenario } from "./scenarioIndex";
import type { GameState, PerSide, PollResult } from "./types";
import { clamp } from "./util";

const toSides = (a: number): PerSide<number> => ({ a, b: 1 - a });

/** Candidate a's expected share of decided votes (0..1), segment-level, no noise. */
export function expectedShare(state: GameState, scenario: Scenario): number {
  const outcomes = segmentOutcomes(state, scenario);
  let votes = 0;
  let votesA = 0;
  scenario.segments.forEach((seg, i) => {
    const o = outcomes[i];
    if (!o) return;
    votes += seg.share * o.pVote;
    votesA += seg.share * o.pVote * o.pA;
  });
  return votes > 0 ? votesA / votes : 0.5;
}

/** Samples `pollSample` voters for `state.year` and adds bounded noise. */
export function runPoll(state: GameState, scenario: Scenario): PollResult {
  const { tuning, regionIndex } = indexScenario(scenario);
  const e = electorate(state, scenario);
  const noisy = (share: number, rng: Rng): number =>
    clamp(share + (rng.next() * 2 - 1) * tuning.pollNoise, 0.01, 0.99);

  // National: expected values over a sample of voters (with replacement).
  const rng = createRng(state.seed, "poll", state.year);
  let votes = 0;
  let votesA = 0;
  for (let i = 0; i < tuning.pollSample; i++) {
    const v = rng.int(e.count);
    votes += e.pVote[v] ?? 0;
    votesA += (e.pVote[v] ?? 0) * (e.pA[v] ?? 0);
  }
  const national = noisy(votes > 0 ? votesA / votes : 0.5, rng);

  // Regions: expected values over all voters in the region.
  const regionVotes = new Float64Array(regionIndex.size);
  const regionVotesA = new Float64Array(regionIndex.size);
  for (let v = 0; v < e.count; v++) {
    const r = e.regionOf[v] ?? 0;
    regionVotes[r] = (regionVotes[r] ?? 0) + (e.pVote[v] ?? 0);
    regionVotesA[r] = (regionVotesA[r] ?? 0) + (e.pVote[v] ?? 0) * (e.pA[v] ?? 0);
  }
  const regions: PollResult["regions"] = {};
  for (const [id, r] of regionIndex) {
    const total = regionVotes[r] ?? 0;
    const share = total > 0 ? (regionVotesA[r] ?? 0) / total : 0.5;
    regions[id] = toSides(noisy(share, createRng(state.seed, "poll", state.year, id)));
  }

  return {
    year: state.year,
    national: toSides(national),
    turnout: votes / tuning.pollSample,
    regions,
  };
}

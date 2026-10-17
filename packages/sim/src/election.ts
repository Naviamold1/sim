import type { Scenario } from "@pb/scenarios";
import { electorate } from "./electorate";
import type { Side } from "./inputs";
import { createRng } from "./rng";
import type { ElectionResult, GameState, PerSide, RegionResult } from "./types";
import { largestRemainder, sum } from "./util";

/** Every voter draws turnout and choice once with the room seed, then the electoral system tallies. */
export function runElection(state: GameState, scenario: Scenario): ElectionResult {
  const regions = scenario.map.regions;
  const e = electorate(state, scenario);
  const rng = createRng(state.seed, "election");

  const votes = regions.map((): PerSide<number> => ({ a: 0, b: 0 }));
  const eligible = regions.map(() => 0);
  for (let v = 0; v < e.count; v++) {
    const r = e.regionOf[v] ?? 0;
    eligible[r] = (eligible[r] ?? 0) + 1;
    // Always draw both so a voter's draws do not depend on the other's outcome.
    const turnsOut = rng.next() < (e.pVote[v] ?? 0);
    const picksA = rng.next() < (e.pA[v] ?? 0);
    const tally = votes[r];
    if (turnsOut && tally) tally[picksA ? "a" : "b"]++;
  }

  const nationalVotes: PerSide<number> = {
    a: sum(votes.map((v) => v.a)),
    b: sum(votes.map((v) => v.b)),
  };
  const coin = (...parts: string[]): Side => (createRng(state.seed, "election-tie", ...parts).next() < 0.5 ? "a" : "b");
  const leader = (x: PerSide<number>, fallback: () => Side): Side => (x.a > x.b ? "a" : x.b > x.a ? "b" : fallback());
  const nationalLeader = (): Side => leader(nationalVotes, () => coin("national"));

  const results: RegionResult[] = regions.map((region, i) => {
    const regionVotes = votes[i] ?? { a: 0, b: 0 };
    const voted = regionVotes.a + regionVotes.b;
    const winner = leader(regionVotes, () => nationalLeader());
    const seats: PerSide<number> = { a: 0, b: 0 };
    if (scenario.electoralSystem === "fptp-regions") {
      seats[winner] = region.seats;
    } else {
      const [a = 0, b = 0] = largestRemainder([regionVotes.a, regionVotes.b], region.seats);
      seats.a = a;
      seats.b = b;
    }
    const eligibleHere = eligible[i] ?? 0;
    return {
      regionId: region.id,
      votes: regionVotes,
      eligible: eligibleHere,
      turnout: eligibleHere > 0 ? voted / eligibleHere : 0,
      winner,
      seats,
    };
  });

  const seats: PerSide<number> = { a: 0, b: 0 };
  if (scenario.electoralSystem === "fptp-regions") {
    for (const r of results) {
      seats.a += r.seats.a;
      seats.b += r.seats.b;
    }
  } else {
    const totalSeats = sum(regions.map((r) => r.seats));
    const [a = 0, b = 0] = largestRemainder([nationalVotes.a, nationalVotes.b], totalSeats);
    seats.a = a;
    seats.b = b;
    let allocatedA = sum(results.map((result) => result.seats.a));
    while (allocatedA !== a) {
      const increase = allocatedA < a;
      const ranked = results.map((result, index) => {
        const capacity = regions[index]?.seats ?? 0;
        const voted = result.votes.a + result.votes.b;
        const quota = capacity * (voted > 0 ? result.votes.a / voted : 0.5);
        return { result, score: increase ? quota - result.seats.a : result.seats.a - quota };
      }).filter(({ result }) => increase ? result.seats.b > 0 : result.seats.a > 0)
        .sort((left, right) => right.score - left.score);
      const chosen = ranked[0]?.result;
      if (!chosen) throw new Error("Unable to reconcile proportional seats");
      const adjustment = increase ? 1 : -1;
      chosen.seats.a += adjustment;
      chosen.seats.b -= adjustment;
      allocatedA += adjustment;
    }
  }

  const totalVotes = nationalVotes.a + nationalVotes.b;
  const totalEligible = sum(eligible);
  const winner = leader(seats, () => nationalLeader());
  return {
    system: scenario.electoralSystem,
    regions: results,
    national: {
      votes: nationalVotes,
      share: totalVotes > 0 ? { a: nationalVotes.a / totalVotes, b: nationalVotes.b / totalVotes } : { a: 0.5, b: 0.5 },
      turnout: totalEligible > 0 ? totalVotes / totalEligible : 0,
    },
    seats,
    winner,
  };
}

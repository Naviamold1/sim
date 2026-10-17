import type { Scenario } from "@pb/scenarios";
import type { Side } from "./inputs";
import type { Contribution, ContributionSource, GameState } from "./types";
import { expectedShare } from "./voting";

/** The mutable working copy of a year's resolution plus the "why the poll moved" ledger. */
export interface Working {
  state: GameState;
  scenario: Scenario;
  ledger: Ledger;
}

/**
 * Records a Contribution each time `record` is called: the change in candidate a's expected
 * share since the previous call, in percentage points. Call it right after mutating `state`.
 */
export class Ledger {
  readonly entries: Contribution[] = [];
  private last: number;

  constructor(
    private readonly state: GameState,
    private readonly scenario: Scenario,
  ) {
    this.last = expectedShare(state, scenario);
  }

  record(source: ContributionSource, side: Side | null, label: string, secret = false): Contribution {
    const now = expectedShare(this.state, this.scenario);
    const a = 100 * (now - this.last);
    this.last = now;
    const entry: Contribution = { source, side, label, delta: { a, b: -a }, secret };
    this.entries.push(entry);
    return entry;
  }
}

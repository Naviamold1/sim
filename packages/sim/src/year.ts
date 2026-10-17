import type { Scenario } from "@pb/scenarios";
import { applyTurn } from "./actions";
import { rollCorruption } from "./corruption";
import { applyDirectorEvents, applyExposures, eventIdGenerator } from "./events";
import type { DirectorOutput, FocusGroupOutput, TurnInterpretation } from "./inputs";
import { SIDES } from "./inputs";
import { Ledger, type Working } from "./ledger";
import { selectPersonas } from "./personas";
import { applyDrift, applyReactions } from "./reactions";
import { indexScenario } from "./scenarioIndex";
import { YEARS, type GameState, type PendingYear, type PerSide, type TurnRecord, type YearRecap } from "./types";
import { perSide } from "./util";
import { expectedShare, runPoll } from "./voting";

export interface YearInput {
  /** Interpreted turns for this resolution. null = no turn (year 1, or the player sent nothing). */
  turns: PerSide<TurnInterpretation | null>;
  director: DirectorOutput;
}

/**
 * First half of resolving year `state.year + 1`: apply both turns, corruption exposures
 * (`rollCorruption` on the working copy after actions), then director events.
 */
export function beginYear(
  state: GameState,
  scenario: Scenario,
  input: YearInput,
): { state: GameState; pending: PendingYear } {
  if (state.scenarioId !== scenario.meta.id) throw new Error("Scenario does not match game state");
  if (state.year >= YEARS + 1) throw new Error("The campaign has already ended");
  if (state.polls.length !== state.year) throw new Error("Finish the pending year before beginning another");
  if (state.year === 0 && (input.turns.a || input.turns.b)) throw new Error("Opening year has no player turns");
  const next = structuredClone(state);
  const year = next.year + 1;
  const w: Working = { state: next, scenario, ledger: new Ledger(next, scenario) };
  const startShare = expectedShare(state, scenario);

  // The turn written at the end of year N feeds resolution N + 1.
  const turnYear = year - 1;
  const turns = perSide((side): TurnRecord | null => {
    const turn = input.turns[side];
    if (!turn) return null;
    const record = applyTurn(w, side, turn, turnYear);
    next.candidates[side].history.push(record);
    return record;
  });

  const nextId = eventIdGenerator(year);
  const exposures = rollCorruption(next, scenario);
  const exposureEvents = applyExposures(w, year, exposures, input.director.exposures, nextId);
  const directorEvents = applyDirectorEvents(w, year, input.director.events, nextId);
  const events = [...exposureEvents, ...directorEvents];
  next.world.events.push(...events);

  const pending: PendingYear = {
    year,
    final: year > YEARS,
    startShare,
    turns,
    exposures,
    events,
    breakdown: w.ledger.entries,
  };
  return { state: next, pending };
}

/**
 * Second half: apply focus group reactions (+ spillover), drift, yearly income, then poll.
 * Personas are recomputed with `selectPersonas` on the incoming state.
 */
export function finishYear(
  state: GameState,
  scenario: Scenario,
  pending: PendingYear,
  focusGroup: FocusGroupOutput,
): { state: GameState; recap: YearRecap } {
  if (state.scenarioId !== scenario.meta.id) throw new Error("Scenario does not match game state");
  if (pending.year !== state.year + 1 || pending.final !== (pending.year > YEARS) || state.year > YEARS) {
    throw new Error("Pending year does not match game state");
  }
  const next = structuredClone(state);
  const { tuning } = indexScenario(scenario);
  const w: Working = { state: next, scenario, ledger: new Ledger(next, scenario) };

  const personas = selectPersonas(state, scenario);
  const quotes = applyReactions(w, personas, focusGroup);
  applyDrift(w, personas);
  if (!pending.final) for (const side of SIDES) next.candidates[side].funds += tuning.yearlyIncome;

  next.year = pending.year;
  const poll = runPoll(next, scenario);

  // Whatever the formulas did not explain is sampling noise relative to the previous poll.
  const previous = state.polls[state.polls.length - 1]?.national.a ?? pending.startShare;
  const explained = [...pending.breakdown, ...w.ledger.entries].reduce((total, c) => total + c.delta.a, 0);
  const noise = 100 * (poll.national.a - previous) - explained;
  const breakdown = [
    ...structuredClone(pending.breakdown),
    ...w.ledger.entries,
    {
      source: "noise" as const,
      side: null,
      label: "Polling noise and sampling",
      delta: { a: noise, b: -noise },
      secret: false,
    },
  ];

  const recap: YearRecap = { ...structuredClone(pending), breakdown, quotes, poll };
  next.polls.push(poll);
  next.recaps.push(structuredClone(recap));
  return { state: next, recap };
}

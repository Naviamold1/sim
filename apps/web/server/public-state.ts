import type { Candidate, PendingYear, Side, TurnRecord, YearRecap } from "@pb/sim";
import type { PublicCandidate, PublicRecap } from "../shared/protocol";

export function publicCandidate(candidate: Candidate): PublicCandidate {
  const { side, nickname, name, party, ideology, background, bio, slogan, strengths, weaknesses, positions, trust, charisma, credibility, promises } = candidate;
  return structuredClone({ side, nickname, name, party, ideology, background, bio, slogan, strengths, weaknesses, positions, trust, charisma, credibility, promises });
}

function publicTurn(turn: TurnRecord | null, owner: Side, viewer: Side): TurnRecord | null {
  if (!turn) return null;
  if (owner === viewer) return structuredClone(turn);
  const applied = turn.applied.filter((action) => !action.secret);
  return structuredClone({ year: turn.year, submitted: turn.submitted, summary: applied.map((action) => action.description).join(" ") || "No public campaign activity.", flipFlop: turn.flipFlop, applied, dropped: [] });
}

export function publicRecap(recap: PendingYear | YearRecap, viewer: Side): PublicRecap {
  const finished = "poll" in recap;
  return structuredClone({
    year: recap.year,
    final: recap.final,
    events: recap.events,
    turns: { a: publicTurn(recap.turns.a, "a", viewer), b: publicTurn(recap.turns.b, "b", viewer) },
    breakdown: recap.breakdown.filter((entry) => !entry.secret || entry.side === viewer),
    quotes: finished ? recap.quotes : [],
    poll: finished ? recap.poll : null,
    pending: !finished,
  });
}

import type { EventTemplate, Scenario } from "@pb/scenarios";
import type { Candidate, GameState, PendingYear, Side } from "@pb/sim";

export const otherSide = (side: Side): Side => (side === "a" ? "b" : "a");

export interface AvailableTemplate {
  template: EventTemplate;
  remaining: number;
}

/** Event templates that can still fire in this game. */
export function availableTemplates(scenario: Scenario, state: GameState): AvailableTemplate[] {
  return scenario.events.templates
    .map((template) => ({ template, remaining: template.maxPerGame - (state.world.templateUses[template.id] ?? 0) }))
    .filter((t) => t.remaining > 0);
}

/** Public summaries of a candidate's most recent submitted turns, oldest first. Summaries never reveal covert corruption. */
export function recentSummaries(candidate: Candidate, count: number): string[] {
  return candidate.history
    .filter((turn) => turn.submitted && turn.summary.trim() !== "")
    .slice(-count)
    .map((turn) => {
      const publicKinds = [...new Set(turn.applied.filter((action) => !action.secret).map((action) => action.kind))];
      const safeSummary = publicKinds.length > 0 ? `Campaign activity: ${publicKinds.join(", ")}.` : "No public campaign activity.";
      return `year ${turn.year}: ${turn.applied.some((action) => action.secret) ? safeSummary : turn.summary}`;
    });
}

/** Descriptions of the applied actions anyone can see (covert actions excluded). */
export function publicActions(pending: PendingYear, side: Side): string[] {
  return (pending.turns[side]?.applied ?? []).filter((a) => !a.secret && a.kind !== "corruption").map((a) => a.description);
}

export function regionName(scenario: Scenario, id: string): string {
  return scenario.map.regions.find((r) => r.id === id)?.name ?? id;
}

/** "a, b and c" */
export function joinList(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

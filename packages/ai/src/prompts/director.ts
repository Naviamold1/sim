import type { EventTemplate, Scenario } from "@pb/scenarios";
import type { Exposure, GameState } from "@pb/sim";
import { YEARS } from "@pb/sim";
import { availableTemplates, joinList, recentSummaries } from "../context";
import { issueLines, listOrNone, scenarioHeader, systemPrompt, type Prompt } from "./common";

function targeting(t: EventTemplate): string {
  if (t.target.national) return "national (regions: [])";
  const parts: string[] = [];
  if (t.target.regions.length > 0) parts.push(`only in ${t.target.regions.join(", ")}`);
  if (t.target.minUrban > 0) parts.push(`urban areas (urban >= ${t.target.minUrban})`);
  if (t.target.maxUrban < 1) parts.push(`rural areas (urban <= ${t.target.maxUrban})`);
  return `regional: pick 1-3 regions${parts.length > 0 ? `, ${parts.join(", ")}` : ""}`;
}

export function directorPrompt(scenario: Scenario, input: { state: GameState; exposures: Exposure[] }): Prompt {
  const { state, exposures } = input;
  const year = state.year + 1;
  const final = year > YEARS;
  const when = final ? "the final campaign stretch before the election" : `year ${year} of ${YEARS}`;

  const templates = availableTemplates(scenario, state).map(
    ({ template: t, remaining }) =>
      `- ${t.id} | ${t.name} | ${t.rarity} | ${remaining} use${remaining === 1 ? "" : "s"} left | ${targeting(t)}`,
  );
  const recent = state.world.events.slice(-6).map((e) => `- (year ${e.year}) ${e.headline}`);
  const candidates = (["a", "b"] as const).map((side) => {
    const c = state.candidates[side];
    return `- ${c.name}: ${listOrNone(recentSummaries(c, 1), "no moves yet")}`;
  });
  const narrate = exposures.map(
    (e) => `- case ${e.caseId} | ${state.candidates[e.side].name} | ${e.size} | ${e.description}`,
  );

  const prompt = `${scenarioHeader(scenario)}
Era flavor: ${scenario.events.flavor}
Start of game: economy "${scenario.start.economy}", national mood "${scenario.start.mood}".

You are the world director for ${when}. Decide what happens to the country this year.

Recent events:
${listOrNone(recent)}

Event templates you may use (id | name | rarity | uses left | targeting):
${listOrNone(templates)}

Valid regions (id, name, urban fraction):
${scenario.map.regions.map((region) => `${region.id}: ${region.name}, ${region.urban}`).join("\n")}
Valid issues for custom deltas:
${issueLines(scenario)}

Candidates' latest public moves:
${candidates.join("\n")}

Corruption exposures to narrate (${exposures.length}):
${listOrNone(narrate)}

Rules:
- Write 1-2 events. Prefer templates: set templateId, severity 1-3 (3 = dramatic; most are 1-2) and regions per the targeting (national = empty regions), custom = null.
- Use common templates freely, uncommon ones sometimes, rare ones only rarely and never twice in a row. Do not repeat a recent event unless it clearly escalates.
- A custom event (templateId null) must be plausible for the era and modest: fill custom with issue salience/position deltas (each within ±0.15) and an engagement delta within ±0.15; keep it small.
- Events must not favour either candidate and must not invent election results, polls or scandals.
- headline: short and newsy (max 12 words). description: 1-2 sentences.
- exposures: write exactly one narrative per case above (same caseId), headline + description, naming the candidate. If there are none, return an empty array.${final ? "\n- This is the final stretch: favour events that sharpen the campaign." : ""}`;
  return { system: systemPrompt("the world director and news writer"), prompt };
}

export { joinList as _joinList };

import type { Scenario, Segment } from "@pb/scenarios";
import { effectiveSalience, segmentOutcomes, type Outcome } from "./electorate";
import { createRng } from "./rng";
import { indexScenario, type ScenarioIndex } from "./scenarioIndex";
import type { GameState, Persona } from "./types";

const MIN_PERSONAS = 8;
const MAX_PERSONAS = 16;

/** 8-16 personas: the most populous segments plus coverage of every region and class. Deterministic. */
export function selectPersonas(state: GameState, scenario: Scenario): Persona[] {
  const ix = indexScenario(scenario);
  const outcomes = segmentOutcomes(state, scenario);
  return pickSegments(scenario)
    .map((seg) => render(state, scenario, ix, seg, outcomes[scenario.segments.indexOf(seg)]))
    .filter((p): p is Persona => p !== null);
}

/** Priority order: one per region, then missing classes, then missing age groups, then the biggest remaining. */
function pickSegments(scenario: Scenario): Segment[] {
  const bySize = [...scenario.segments].sort((x, y) => y.share - x.share); // stable: ties keep scenario order
  const picked: Segment[] = [];
  const add = (seg: Segment | undefined) => {
    if (seg && !picked.includes(seg)) picked.push(seg);
  };
  const biggest = (match: (s: Segment) => boolean) => bySize.find(match);

  for (const r of scenario.map.regions) add(biggest((s) => s.regionId === r.id));
  for (const c of scenario.classes) if (!picked.some((s) => s.classId === c.id)) add(biggest((s) => s.classId === c.id));
  for (const a of scenario.ages) if (!picked.some((s) => s.ageId === a.id)) add(biggest((s) => s.ageId === a.id));
  const target = Math.min(MIN_PERSONAS, scenario.segments.length);
  for (const seg of bySize) {
    if (picked.length >= target) break;
    add(seg);
  }
  return picked.slice(0, MAX_PERSONAS);
}

function render(state: GameState, scenario: Scenario, ix: ScenarioIndex, def: Segment, outcome: Outcome | undefined): Persona | null {
  const seg = state.segments[def.id];
  const region = ix.regionById.get(def.regionId);
  const cls = ix.classById.get(def.classId);
  const age = ix.ageById.get(def.ageId);
  if (!seg || !region || !cls || !age || !outcome) return null;

  const rng = createRng(state.seed, "persona", def.id);
  const years = age.min + rng.int(age.max - age.min + 1);
  const occupation = cls.occupations[rng.int(cls.occupations.length)] ?? cls.name.toLowerCase();
  const area = region.urban >= 0.65 ? "mostly urban" : region.urban <= 0.35 ? "mostly rural" : "mixed";

  const salience = effectiveSalience(seg.salience, state.world.salienceModifiers, ix.issueIds);
  const cares = ix.issueIds
    .map((id, i) => ({ id, weight: salience[i] ?? 0 }))
    .sort((x, y) => y.weight - x.weight)
    .slice(0, 3)
    .map(({ id }) => {
      const issue = ix.issueById.get(id);
      const pos = seg.positions[id] ?? 0;
      const lean = Math.abs(pos) < 0.15 ? "in the middle" : `leans ${pos < 0 ? issue?.negLabel : issue?.posLabel}`;
      return `${issue?.name ?? id} (${lean})`;
    });
  const habit = outcome.pVote >= 0.7 ? "usually votes" : outcome.pVote >= 0.4 ? "votes sometimes" : "rarely votes";
  const description =
    `${years}-year-old ${occupation} in ${region.name} (${cls.name}, ${area} area). ` +
    `${def.concerns.replace(/\.+$/, "")}. Cares most about: ${cares.join(", ")}. ${capitalize(habit)}.`;

  return {
    id: def.id,
    segmentId: def.id,
    regionId: def.regionId,
    classId: def.classId,
    ageId: def.ageId,
    age: years,
    occupation,
    label: `${years}, ${occupation}, ${region.name}`,
    description,
    leaning: leaning(state, outcome),
  };
}

function leaning(state: GameState, outcome: Outcome): string {
  const { a, b } = state.candidates;
  const top = Math.max(outcome.pA, 1 - outcome.pA);
  const choice =
    top >= 0.55
      ? `leans to ${outcome.pA >= 0.5 ? a.name : b.name} (${Math.round(top * 100)}%)`
      : `torn between ${a.name} and ${b.name}`;
  return outcome.pVote < 0.4 ? `${choice}, unlikely to vote` : choice;
}

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

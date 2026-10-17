import type { EventTemplate, Region } from "@pb/scenarios";
import type { DirectorEvent, DirectorOutput } from "./inputs";
import type { Working } from "./ledger";
import { createRng } from "./rng";
import { indexScenario, type ScenarioIndex } from "./scenarioIndex";
import { bumpSalience, shiftEngagement, shiftPosition } from "./segmentOps";
import type { AppliedEvent, Exposure, IssueValues, SegmentState } from "./types";
import { clamp, clamp01, clean } from "./util";

/** Exposures and director events for one year. */

export const MAX_DIRECTOR_EVENTS = 2;
const CUSTOM_LIMIT = 0.15;
const SEVERITY_BY_SIZE = { small: 1, medium: 2, big: 3 } as const;

/** What an event does to the electorate, already scaled. */
interface Impact {
  salience: IssueValues;
  positions: IssueValues;
  engagement: number;
}

/** Hands out `y${year}-e${n}` ids. */
export function eventIdGenerator(year: number): () => string {
  let n = 0;
  return () => `y${year}-e${++n}`;
}

/** Marks rolled cases as exposed, applies the trust hit and creates a narrated exposure event per case. */
export function applyExposures(
  w: Working,
  year: number,
  exposures: Exposure[],
  narration: DirectorOutput["exposures"],
  nextId: () => string,
): AppliedEvent[] {
  const { tuning } = indexScenario(w.scenario);
  const events: AppliedEvent[] = [];
  for (const exposure of exposures) {
    const cand = w.state.candidates[exposure.side];
    const found = cand.corruptionCases.find((c) => c.id === exposure.caseId);
    if (!found || found.exposed) continue;
    found.exposed = true;
    found.yearExposed = year;
    const hit = tuning.corruptionTrustHit[found.size];
    cand.trust = clamp01(cand.trust - hit);
    cand.credibility = clamp01(cand.credibility - hit / 2);

    const told = narration.find((n) => n.caseId === exposure.caseId);
    const headline = clean(told?.headline ?? "", 90) || `${cand.name} caught in ${found.size} corruption scandal`;
    const description = clean(told?.description ?? "", 280) || clean(found.description, 280);
    events.push({
      id: nextId(),
      year,
      kind: "exposure",
      templateId: null,
      severity: SEVERITY_BY_SIZE[found.size],
      regions: [],
      headline,
      description,
      side: exposure.side,
    });
    w.ledger.record("exposure", exposure.side, headline);
  }
  return events;
}

/** Applies at most MAX_DIRECTOR_EVENTS valid events. Invalid ones are dropped silently. */
export function applyDirectorEvents(w: Working, year: number, events: DirectorEvent[], nextId: () => string): AppliedEvent[] {
  const applied: AppliedEvent[] = [];
  events.slice(0, MAX_DIRECTOR_EVENTS).forEach((event, index) => {
    const result = event.templateId === null ? applyCustom(w, event) : applyTemplate(w, year, event, index);
    if (!result) return;
    const text = fillText(w, event, result.template, result.regions);
    const headline = clean(event.headline, 90) || text.headline;
    applied.push({
      id: nextId(),
      year,
      kind: result.template ? "template" : "custom",
      templateId: result.template?.id ?? null,
      severity: result.severity,
      regions: result.regions,
      headline,
      description: clean(event.description, 280) || text.description,
      side: null,
    });
    w.ledger.record("event", null, `Event: ${headline}`);
  });
  return applied;
}

interface Applied {
  template: EventTemplate | null;
  severity: number;
  /** Region ids, empty = national. */
  regions: string[];
}

function applyTemplate(w: Working, year: number, event: DirectorEvent, index: number): Applied | null {
  const ix = indexScenario(w.scenario);
  const template = event.templateId === null ? undefined : ix.templateById.get(event.templateId);
  if (!template || (w.state.world.templateUses[template.id] ?? 0) >= template.maxPerGame) return null;
  const severity = Math.round(clamp(event.severity, 1, 3));
  const scaled = (values: IssueValues): IssueValues =>
    Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v * severity]));
  const impact: Impact = {
    salience: scaled(template.impacts.salience),
    positions: scaled(template.impacts.positions),
    engagement: template.impacts.engagement * severity,
  };

  if (template.target.national) {
    // National salience lives in the world modifiers (it fades); everything else hits all segments.
    for (const [issue, delta] of Object.entries(impact.salience)) {
      if (issue in w.state.world.salienceModifiers) {
        w.state.world.salienceModifiers[issue] = (w.state.world.salienceModifiers[issue] ?? 0) + delta;
      }
    }
    applyImpact(Object.values(w.state.segments), { ...impact, salience: {} });
    countUse(w, template);
    return { template, severity, regions: [] };
  }

  const eligible = eligibleRegions(template, ix);
  if (eligible.length === 0) return null;
  const eligibleIds = new Set(eligible.map((r) => r.id));
  let regions = [...new Set(event.regions)].filter((id) => eligibleIds.has(id));
  if (regions.length === 0) {
    const pick = createRng(w.state.seed, "event-region", year, index).weighted(eligible.map((r) => r.share));
    const chosen = eligible[pick] ?? eligible[0];
    if (!chosen) return null;
    regions = [chosen.id];
  }
  applyImpact(segmentsInRegions(w, ix, regions), impact);
  countUse(w, template);
  return { template, severity, regions };
}

function applyCustom(w: Working, event: DirectorEvent): Applied | null {
  if (!event.custom) return null;
  const ix = indexScenario(w.scenario);
  const toValues = (deltas: { issue: string; delta: number }[]): IssueValues => {
    const values: IssueValues = {};
    for (const { issue, delta } of deltas) {
      if (!ix.issueById.has(issue)) continue;
      values[issue] = clamp((values[issue] ?? 0) + clamp(delta, -CUSTOM_LIMIT, CUSTOM_LIMIT), -CUSTOM_LIMIT, CUSTOM_LIMIT);
    }
    return values;
  };
  const regions = [...new Set(event.regions)].filter((id) => ix.regionById.has(id));
  if (event.regions.length > 0 && regions.length === 0) return null;
  const segments = regions.length > 0 ? segmentsInRegions(w, ix, regions) : Object.values(w.state.segments);
  applyImpact(segments, {
    salience: toValues(event.custom.salience),
    positions: toValues(event.custom.positions),
    engagement: clamp(event.custom.engagement, -CUSTOM_LIMIT, CUSTOM_LIMIT),
  });
  return { template: null, severity: Math.round(clamp(event.severity, 1, 3)), regions };
}

function applyImpact(segments: SegmentState[], impact: Impact): void {
  for (const seg of segments) {
    for (const [issue, delta] of Object.entries(impact.salience)) bumpSalience(seg, issue, delta);
    for (const [issue, delta] of Object.entries(impact.positions)) shiftPosition(seg, issue, delta);
    shiftEngagement(seg, impact.engagement);
  }
}

function eligibleRegions(template: EventTemplate, ix: ScenarioIndex): Region[] {
  const { regions, minUrban, maxUrban } = template.target;
  return [...ix.regionById.values()].filter(
    (r) => (regions.length === 0 || regions.includes(r.id)) && r.urban >= minUrban && r.urban <= maxUrban,
  );
}

function segmentsInRegions(w: Working, ix: ScenarioIndex, regionIds: string[]): SegmentState[] {
  return regionIds.flatMap((id) => (ix.segmentsByRegion.get(id) ?? []).flatMap((s) => w.state.segments[s.id] ?? []));
}

function countUse(w: Working, template: EventTemplate): void {
  w.state.world.templateUses[template.id] = (w.state.world.templateUses[template.id] ?? 0) + 1;
}

/** Template text (or a generic line) used when the director gave no headline/description. */
function fillText(w: Working, event: DirectorEvent, template: EventTemplate | null, regionIds: string[]) {
  const ix = indexScenario(w.scenario);
  const names = regionIds.map((id) => ix.regionById.get(id)?.name ?? id);
  const where = names.length > 0 ? names.join(", ") : w.scenario.meta.country;
  const fill = (text: string) => text.replaceAll("{region}", where);
  return {
    headline: template ? fill(template.headline) : "An unexpected development",
    description: template ? fill(template.description) : "",
  };
}

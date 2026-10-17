import type { FocusGroupOutput } from "./inputs";
import { SIDES } from "./inputs";
import type { Working } from "./ledger";
import { indexScenario } from "./scenarioIndex";
import { bumpSalience, shiftAffinity, shiftEngagement } from "./segmentOps";
import type { Persona, Quote, SegmentState } from "./types";
import { clamp, clean } from "./util";

/** Focus group reactions (with class spillover) and the slow drift of segments nobody was asked about. */

const DECAY_TO_START_VISIBILITY = 0.1;
const SALIENCE_MODIFIER_DECAY = 0.5;

interface Delta {
  a: number;
  b: number;
  engagement: number;
}

/** Applies each persona's first reaction; unknown personas are ignored. Returns the quotes to show. */
export function applyReactions(w: Working, personas: Persona[], output: FocusGroupOutput): Quote[] {
  const ix = indexScenario(w.scenario);
  const byId = new Map(personas.map((p) => [p.id, p]));
  const seen = new Set<string>();
  const quotes: Quote[] = [];

  for (const reaction of output.reactions) {
    const persona = byId.get(reaction.personaId);
    if (!persona || seen.has(persona.id)) continue;
    seen.add(persona.id);

    const delta: Delta = {
      a: clamp(reaction.affinityDelta.a, -0.2, 0.2),
      b: clamp(reaction.affinityDelta.b, -0.2, 0.2),
      engagement: clamp(reaction.engagementDelta, -0.1, 0.1),
    };
    const shift = reaction.salienceShift;
    const salience = shift && ix.issueById.has(shift.issue) ? { issue: shift.issue, delta: clamp(shift.delta, -0.1, 0.1) } : null;

    const own = w.state.segments[persona.segmentId];
    if (own) apply(own, delta, salience, 1);
    for (const other of w.scenario.segments) {
      if (other.classId !== persona.classId || other.regionId === persona.regionId) continue;
      const seg = w.state.segments[other.id];
      if (seg) apply(seg, delta, salience, ix.tuning.spillover);
    }

    const text = clean(reaction.quote, 220);
    if (text) quotes.push({ segmentId: persona.segmentId, regionId: persona.regionId, persona: persona.label, quote: text });
  }
  w.ledger.record("focusGroup", null, "Focus group reactions");
  return quotes;
}

function apply(seg: SegmentState, delta: Delta, salience: { issue: string; delta: number } | null, scale: number): void {
  for (const side of SIDES) shiftAffinity(seg, side, delta[side] * scale);
  shiftEngagement(seg, delta.engagement * scale);
  if (salience) bumpSalience(seg, salience.issue, salience.delta * scale);
}

/**
 * Segments without a persona drift toward the mean affinity of persona segments in their region
 * or class; world salience and visibility fade back toward their baselines.
 */
export function applyDrift(w: Working, personas: Persona[]): void {
  const ix = indexScenario(w.scenario);
  const personaIds = new Set(personas.map((p) => p.segmentId));
  const anchors = w.scenario.segments.filter((s) => personaIds.has(s.id));

  for (const def of w.scenario.segments) {
    if (personaIds.has(def.id)) continue;
    const seg = w.state.segments[def.id];
    const neighbours = anchors.filter((a) => a.regionId === def.regionId || a.classId === def.classId);
    const weight = neighbours.reduce((total, n) => total + n.share, 0);
    if (!seg || weight === 0) continue;
    for (const side of SIDES) {
      const mean = neighbours.reduce((total, n) => total + n.share * (w.state.segments[n.id]?.affinity[side] ?? 0), 0) / weight;
      shiftAffinity(seg, side, ix.tuning.drift * (mean - seg.affinity[side]));
    }
  }

  const modifiers = w.state.world.salienceModifiers;
  for (const issue of Object.keys(modifiers)) modifiers[issue] = (modifiers[issue] ?? 0) * SALIENCE_MODIFIER_DECAY;
  for (const cand of Object.values(w.state.candidates)) {
    for (const id of Object.keys(cand.visibility)) {
      const v = cand.visibility[id] ?? 0;
      cand.visibility[id] = v + DECAY_TO_START_VISIBILITY * (ix.tuning.startingVisibility - v);
    }
  }
  w.ledger.record("drift", null, "Drift and fading attention");
}

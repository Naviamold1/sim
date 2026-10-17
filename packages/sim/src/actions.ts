import type { Region } from "@pb/scenarios";
import type { Action, Side, TurnInterpretation } from "./inputs";
import { ActionKindSchema, ChannelSchema, CorruptionSizeSchema, NATIONAL } from "./inputs";
import type { Working } from "./ledger";
import { indexScenario, type ScenarioIndex } from "./scenarioIndex";
import { bumpSalience, shiftAffinity, shiftEngagement, shiftPosition } from "./segmentOps";
import type { AppliedAction, Candidate, DroppedAction, SegmentState, TurnRecord } from "./types";
import { clamp, clamp01, clampSigned, clean, otherSide } from "./util";

/** Applies one interpreted turn: validates, budgets and charges each action, then applies its effects. */

const FLIP_FLOP_CREDIBILITY = 0.06;
const BROKEN_PROMISE_CREDIBILITY = 0.08;
const BROKEN_PROMISE_GAP = 0.8;
const POSITION_STEP = 0.1;
const SALIENCE_BUMP = { statement: 0.02, promise: 0.03, reform: 0.04 } as const;
const CORRUPTION_VISIBILITY = { small: 0.03, medium: 0.06, big: 0.09 } as const;

/** Who an action reaches. */
interface Reach {
  regionIds: string[];
  segments: SegmentState[];
}

export function applyTurn(w: Working, side: Side, turn: TurnInterpretation, turnYear: number): TurnRecord {
  const { state, ledger } = w;
  const ix = indexScenario(w.scenario);
  const cand = state.candidates[side];

  if (turn.flipFlop) {
    cand.credibility = clamp01(cand.credibility - FLIP_FLOP_CREDIBILITY);
    ledger.record("action", side, `${cand.name}: flip-flopped on an earlier position`);
  }

  const applied: AppliedAction[] = [];
  const dropped: DroppedAction[] = [];
  let remaining = ix.tuning.actionPoints;
  let corruptionCases = 0;

  for (const action of turn.actions) {
    if (!isValid(action, ix)) {
      dropped.push({ action: structuredClone(action), reason: "invalid" });
      continue;
    }
    const requested = Math.round(clamp(action.intensity, 1, 3));
    let intensity = Math.min(requested, remaining);
    if (intensity <= 0) {
      dropped.push({ action: structuredClone(action), reason: "budget" });
      continue;
    }
    const channel = action.kind === "media" ? (action.channel ?? "social") : null;
    const perPoint = costPerPoint(ix, action, channel);
    if (perPoint > 0) intensity = Math.min(intensity, Math.floor(cand.funds / perPoint));
    if (intensity <= 0) {
      dropped.push({ action: structuredClone(action), reason: "funds" });
      continue;
    }

    const target = resolveTarget(action, ix);
    const cost = perPoint * intensity;
    cand.funds -= cost;
    remaining -= intensity;

    const issue = action.issue !== null && ix.issueById.has(action.issue) ? action.issue : null;
    const record: AppliedAction = {
      kind: action.kind,
      issue,
      stance: action.stance === null ? null : clampSigned(action.stance),
      target,
      channel,
      intensity,
      requestedIntensity: requested,
      cost,
      description: clean(action.description, 120) || action.kind,
      secret: action.kind === "corruption",
    };
    const effects = { w, side, cand, ix, turnYear, record, reach: reachOf(target, ix, w) };
    applyEffects(effects, action, corruptionCases + 1);
    if (action.kind === "corruption") corruptionCases++;
    applied.push(record);
    ledger.record(record.kind === "corruption" ? "corruption" : "action", side, `${cand.name}: ${record.description}`, record.secret);
  }

  return {
    year: turnYear,
    submitted: true,
    summary: clean(turn.summary, 200),
    flipFlop: turn.flipFlop,
    applied,
    dropped,
  };
}

function isValid(action: Action, ix: ScenarioIndex): boolean {
  if (!ActionKindSchema.safeParse(action.kind).success || !Number.isFinite(action.intensity) || action.intensity <= 0) return false;
  if (action.channel !== null && !ChannelSchema.safeParse(action.channel).success) return false;
  if (action.corruptionSize !== null && !CorruptionSizeSchema.safeParse(action.corruptionSize).success) return false;
  if (action.target !== null && action.target !== NATIONAL && !ix.regionById.has(action.target) && !ix.segmentById.has(action.target)) return false;
  if (action.issue !== null && !ix.issueById.has(action.issue)) return false;
  if (action.kind === "statement" || action.kind === "promise" || action.kind === "reform") {
    return action.issue !== null && ix.issueById.has(action.issue) && action.stance !== null && Number.isFinite(action.stance);
  }
  return true;
}

function costPerPoint(ix: ScenarioIndex, action: Action, channel: "tv" | "social" | null): number {
  if (action.kind === "rally") return ix.tuning.costs.rally;
  if (action.kind === "media") return channel === "tv" ? ix.tuning.costs.tv : ix.tuning.costs.social;
  return 0;
}

/** Region id, segment id or "national". Rallies need a region. */
function resolveTarget(action: Action, ix: ScenarioIndex): string {
  const raw = action.target ?? NATIONAL;
  const known = ix.regionById.has(raw) || ix.segmentById.has(raw);
  const target = known ? raw : NATIONAL;
  if (action.kind !== "rally") return target;
  const segment = ix.segmentById.get(target);
  if (segment) return segment.regionId;
  if (ix.regionById.has(target)) return target;
  return mostPopulousRegion(ix).id;
}

function mostPopulousRegion(ix: ScenarioIndex): Region {
  let best: Region | undefined;
  for (const r of ix.regionById.values()) if (!best || r.share > best.share) best = r;
  if (!best) throw new Error("scenario has no regions");
  return best;
}

function reachOf(target: string, ix: ScenarioIndex, w: Working): Reach {
  const states = (ids: string[]) => ids.flatMap((id) => w.state.segments[id] ?? []);
  const segment = ix.segmentById.get(target);
  if (segment) return { regionIds: [segment.regionId], segments: states([segment.id]) };
  if (ix.regionById.has(target)) {
    return { regionIds: [target], segments: states((ix.segmentsByRegion.get(target) ?? []).map((s) => s.id)) };
  }
  return { regionIds: [...ix.regionById.keys()], segments: Object.values(w.state.segments) };
}

interface Effects {
  w: Working;
  side: Side;
  cand: Candidate;
  ix: ScenarioIndex;
  turnYear: number;
  record: AppliedAction;
  reach: Reach;
}

function addVisibility(cand: Candidate, regionIds: readonly string[], amount: number): void {
  for (const id of regionIds) cand.visibility[id] = clamp01((cand.visibility[id] ?? 0) + amount);
}

function applyEffects(e: Effects, action: Action, caseNumber: number): void {
  const { cand, record, reach, side } = e;
  const n = record.intensity;
  const m = 0.75 + 0.5 * cand.charisma;
  const issue = record.issue;

  switch (record.kind) {
    case "statement":
    case "promise":
    case "reform": {
      if (issue === null || record.stance === null) return;
      breakContradictedPromises(e, issue, record.stance);
      const current = cand.positions[issue] ?? 0;
      const step = Math.min(Math.abs(record.stance - current), POSITION_STEP * n);
      cand.positions[issue] = clampSigned(current + Math.sign(record.stance - current) * step);
      for (const seg of reach.segments) bumpSalience(seg, issue, SALIENCE_BUMP[record.kind] * n);
      addVisibility(cand, reach.regionIds, 0.01 * n * m);
      if (record.kind !== "statement") {
        cand.promises.push({ year: e.turnYear, issue, stance: record.stance, description: record.description, broken: false });
      }
      return;
    }
    case "media": {
      if (record.channel === "tv") {
        addVisibility(cand, [...e.ix.regionById.keys()], 0.05 * n * m);
        for (const seg of Object.values(e.w.state.segments)) shiftAffinity(seg, side, 0.008 * n);
      } else {
        const national = record.target === NATIONAL;
        addVisibility(cand, reach.regionIds, (national ? 0.02 : 0.04) * n * m);
        for (const seg of reach.segments) {
          const socialReach = socialReachOf(e, seg);
          shiftEngagement(seg, 0.01 * n * socialReach);
          shiftAffinity(seg, side, 0.012 * n * socialReach);
        }
      }
      if (issue !== null && record.channel === "social") {
        for (const seg of reach.segments) bumpSalience(seg, issue, 0.02 * n);
      }
      return;
    }
    case "rally": {
      addVisibility(cand, reach.regionIds, 0.12 * n * m);
      for (const seg of reach.segments) {
        shiftEngagement(seg, 0.03 * n);
        shiftAffinity(seg, side, 0.01 * n);
      }
      return;
    }
    case "attack": {
      const opponent = e.w.state.candidates[otherSide(side)];
      opponent.trust = clamp01(opponent.trust - 0.03 * n * m);
      cand.trust = clamp01(cand.trust - 0.01 * n);
      if (issue !== null) for (const seg of Object.values(e.w.state.segments)) bumpSalience(seg, issue, 0.01 * n);
      return;
    }
    case "corruption": {
      const size = action.corruptionSize ?? "small";
      cand.funds += e.ix.tuning.corruptionFunds[size];
      addVisibility(cand, [...e.ix.regionById.keys()], CORRUPTION_VISIBILITY[size]);
      cand.corruptionCases.push({
        id: `${side}-${e.turnYear}-${caseNumber}`,
        size,
        yearTaken: e.turnYear,
        exposed: false,
        yearExposed: null,
        description: record.description,
      });
      return;
    }
  }
}

/** Moving away from an earlier, strongly held promise breaks it and costs credibility. */
function breakContradictedPromises(e: Effects, issue: string, stance: number): void {
  for (const p of e.cand.promises) {
    if (p.broken || p.issue !== issue || Math.abs(stance - p.stance) <= BROKEN_PROMISE_GAP) continue;
    p.broken = true;
    e.cand.credibility = clamp01(e.cand.credibility - BROKEN_PROMISE_CREDIBILITY);
  }
}

function socialReachOf(e: Effects, seg: SegmentState): number {
  const def = e.ix.segmentById.get(seg.id);
  return (def && e.ix.ageById.get(def.ageId)?.socialReach) ?? 1;
}

import type { Side } from "./inputs";
import type { SegmentState } from "./types";
import { clamp01, clampSigned, normalizeSalience } from "./util";

/** Small clamped mutations of segment state, shared by actions, events and reactions. */

export function bumpSalience(seg: SegmentState, issue: string, delta: number): void {
  if (!Object.hasOwn(seg.salience, issue)) return;
  seg.salience[issue] = (seg.salience[issue] ?? 0) + delta;
  normalizeSalience(seg.salience);
}

export function shiftPosition(seg: SegmentState, issue: string, delta: number): void {
  if (!Object.hasOwn(seg.positions, issue)) return;
  seg.positions[issue] = clampSigned((seg.positions[issue] ?? 0) + delta);
}

export function shiftEngagement(seg: SegmentState, delta: number): void {
  seg.engagement = clamp01(seg.engagement + delta);
}

export function shiftAffinity(seg: SegmentState, side: Side, delta: number): void {
  seg.affinity[side] = clampSigned(seg.affinity[side] + delta);
}

import type { Side } from "./inputs";
import type { IssueValues, PerSide } from "./types";

/** Clamps into [lo, hi]. Non-finite input (untrusted AI output) counts as 0. */
export function clamp(x: number, lo: number, hi: number): number {
  const v = Number.isFinite(x) ? x : 0;
  return Math.min(hi, Math.max(lo, v));
}

export const clamp01 = (x: number): number => clamp(x, 0, 1);
export const clampSigned = (x: number): number => clamp(x, -1, 1);

/** Trims and truncates untrusted text. */
export function clean(text: string, max: number): string {
  return text.trim().slice(0, max).trim();
}

export const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));

export const otherSide = (side: Side): Side => (side === "a" ? "b" : "a");

export const sum = (values: readonly number[]): number => values.reduce((total, v) => total + v, 0);

export const perSide = <T>(make: (side: Side) => T): PerSide<T> => ({ a: make("a"), b: make("b") });

/** Floors at 0 and rescales to sum 1 in place. All-zero input becomes uniform. */
export function normalizeSalience(salience: IssueValues): void {
  const keys = Object.keys(salience);
  let total = 0;
  for (const k of keys) {
    const value = salience[k] ?? 0;
    const v = Number.isFinite(value) ? Math.max(0, value) : 0;
    salience[k] = v;
    total += v;
  }
  for (const k of keys) salience[k] = total > 0 ? (salience[k] ?? 0) / total : 1 / keys.length;
}

/**
 * Splits `total` whole units across `weights` proportionally (largest remainder method).
 * Ties go to the earlier index. All-zero weights split evenly.
 */
export function largestRemainder(weights: readonly number[], total: number): number[] {
  const safe = weights.map((w) => Math.max(0, w));
  const weightSum = sum(safe);
  const quotas = safe.map((w) => (weightSum > 0 ? (w / weightSum) * total : total / safe.length));
  const result = quotas.map(Math.floor);
  const order = quotas
    .map((q, i) => ({ i, rest: q - Math.floor(q) }))
    .sort((x, y) => y.rest - x.rest || x.i - y.i);
  let left = total - sum(result);
  for (const { i } of order) {
    if (left <= 0) break;
    result[i] = (result[i] ?? 0) + 1;
    left--;
  }
  return result;
}

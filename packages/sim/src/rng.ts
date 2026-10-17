/**
 * Seeded randomness. Every random draw is keyed by (seed, purpose, ...parts) so results do not
 * depend on call order: the poll in year 3 is the same no matter what ran before it.
 */

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform integer in [0, n). */
  int(n: number): number;
  /** Standard normal (mean 0, std 1). */
  gaussian(): number;
  /** Picks an index with probability proportional to its weight. Returns -1 if all weights are 0. */
  weighted(weights: readonly number[]): number;
}

/** 32-bit FNV-1a followed by a murmur3 finalizer. */
function hash(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export function createRng(seed: string, ...parts: Array<string | number>): Rng {
  let state = hash([seed, ...parts].join("\u0000"));
  let spare: number | null = null;

  // mulberry32
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    int: (n) => Math.floor(next() * n),
    gaussian: () => {
      if (spare !== null) {
        const s = spare;
        spare = null;
        return s;
      }
      // Box-Muller; 1 - next() is in (0, 1] so the log is finite.
      const u = 1 - next();
      const v = next();
      const r = Math.sqrt(-2 * Math.log(u));
      spare = r * Math.sin(2 * Math.PI * v);
      return r * Math.cos(2 * Math.PI * v);
    },
    weighted: (weights) => {
      const total = weights.reduce((sum, w) => sum + Math.max(0, w), 0);
      if (total <= 0) return -1;
      let x = next() * total;
      let last = -1;
      for (let i = 0; i < weights.length; i++) {
        const w = Math.max(0, weights[i] ?? 0);
        if (w === 0) continue;
        last = i;
        x -= w;
        if (x < 0) return i;
      }
      return last;
    },
  };
}

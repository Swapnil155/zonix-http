/**
 * Deterministic RNG for the fuzz suites. Zero dependencies, seeded, and the
 * seed is printed on failure so any run can be replayed exactly.
 *
 * mulberry32: small, fast, good enough distribution for input generation.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A seed derived from the run, or SEED from the environment to replay one. */
export function pickSeed(): number {
  const fromEnv = process.env["SEED"];
  if (fromEnv !== undefined && fromEnv !== "") return Number(fromEnv) >>> 0;
  // Deterministic per file+run without Math.random, so failures stay replayable.
  return (Date.now() ^ process.pid) >>> 0;
}

export interface Rng {
  next: () => number;
  int: (maxExclusive: number) => number;
  pick: <T>(items: readonly T[]) => T;
  seed: number;
}

export function makeRng(seed: number): Rng {
  const next = mulberry32(seed);
  const int = (maxExclusive: number): number => Math.floor(next() * maxExclusive);
  return {
    next,
    int,
    pick: <T>(items: readonly T[]): T => items[int(items.length)] as T,
    seed,
  };
}

/**
 * Seeded fuzz for `query/extended.ts`: 10k generated query strings per seed,
 * three seeds, structural parity with `qs@6.15.3`, never throws, no
 * prototype pollution. Replay any failure with SEED=<n>.
 *
 * `prototype` is deliberately absent from the atoms and depth 0 is not
 * sampled: qs keeps `prototype` as a key and, at depth 0, emits
 * `constructor` from `[constructor]`; we drop both (decision 10) - the
 * pollution suite asserts those differences explicitly.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, test } from "node:test";
import { parseExtendedQuery } from "../../lib/query/extended.js";
import { makeRng, pickSeed } from "./rng.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const qs = createRequire(import.meta.url)("qs") as { parse: (s: string, o?: any) => any };
const shape = (v: unknown): unknown => JSON.parse(JSON.stringify(v));

const ATOMS = [
  "a",
  "b",
  "c",
  "0",
  "1",
  "2",
  "19",
  "20",
  "21",
  "5",
  "x",
  "[",
  "]",
  "[]",
  "[0]",
  "[1]",
  "[b]",
  "[ ]",
  "=",
  "&",
  "&&",
  "+",
  "%",
  "%20",
  "%5B",
  "%5D",
  "%5b",
  "%E2%9C%93",
  "%E0%A4%A",
  "%zz",
  ".",
  ",",
  " ",
  "__proto__",
  "[__proto__]",
  "constructor",
  "[constructor]",
  "toString",
  "[toString]",
  "hasOwnProperty",
  "=1",
  "=2",
  "[]=",
  "][",
  "[[",
  "]]",
];

function build(rng: ReturnType<typeof makeRng>): string {
  const n = 1 + rng.int(14);
  let out = "";
  for (let i = 0; i < n; i++) out += rng.pick(ATOMS);
  return out;
}

describe("extended query fuzz: parity with qs on generated input", () => {
  const base = pickSeed();
  for (const seed of [base, (base + 1) >>> 0, (base + 2) >>> 0]) {
    test(`10,000 generated query strings agree (SEED=${seed})`, () => {
      const rng = makeRng(seed);
      for (let i = 0; i < 10_000; i++) {
        const input = build(rng);
        const opts =
          rng.int(4) === 0
            ? { depth: rng.pick([1, 2, 5]), arrayLimit: rng.pick([0, 1, 2, 20]) }
            : undefined;
        let mine: unknown;
        try {
          mine = parseExtendedQuery(input, opts);
        } catch (err) {
          assert.fail(
            `threw on ${JSON.stringify(input)} ${JSON.stringify(opts)}: ${String(err)} (SEED=${seed})`,
          );
        }
        assert.deepEqual(
          shape(mine),
          shape(qs.parse(input, opts)),
          `${JSON.stringify(input)} ${JSON.stringify(opts)} (SEED=${seed})`,
        );
        assert.equal(({} as any).polluted, undefined);
        assert.equal(Object.getPrototypeOf(mine), null);
      }
      assert.equal(Object.keys(Object.prototype).length, 0, "Object.prototype gained a key");
    });
  }
});

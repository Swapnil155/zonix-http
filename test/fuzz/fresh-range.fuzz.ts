/**
 * Seeded fuzz for `http/fresh.ts` and `http/range.ts`: 10k generated inputs
 * each, byte parity with `fresh@0.5.2` / `range-parser@1.2.1`, never throws,
 * linear-looking time. Replay any failure with SEED=<n>.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, test } from "node:test";
import { fresh } from "../../lib/http/fresh.js";
import { parseRange } from "../../lib/http/range.js";
import { makeRng, pickSeed } from "./rng.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const require = createRequire(import.meta.url);
const oracleFresh = require("fresh") as (a: any, b: any) => boolean;
const oracleRange = require("range-parser") as (s: number, r: string, o?: any) => any;

const FRESH_ATOMS = [
  '"abc"',
  '"xyz"',
  "W/",
  "*",
  ",",
  " ",
  "\t",
  " ",
  "\n",
  "no-cache",
  "max-age=0",
  "=",
  "abc",
  '"',
  "Sat, 01 Jan 2000 00:00:00 GMT",
  "Sat, 01 Jan 2000 00:00:01 GMT",
  "x",
];
const RANGE_ATOMS = [
  "bytes",
  "=",
  "-",
  ",",
  " ",
  "0",
  "1",
  "5",
  "9",
  "10",
  "99",
  "100",
  "abc",
  "x",
  "\t",
  " ",
  "1e2",
  "-1",
  "0x1",
];

function build(rng: ReturnType<typeof makeRng>, atoms: readonly string[], max = 10): string {
  let out = "";
  const n = 1 + rng.int(max);
  for (let i = 0; i < n; i++) out += rng.pick(atoms);
  return out;
}

const maybe = (rng: ReturnType<typeof makeRng>, atoms: readonly string[]) =>
  rng.int(5) === 0 ? undefined : build(rng, atoms);

describe("fresh/range fuzz: parity with the oracles on generated input", () => {
  test("fresh: 10,000 generated header sets agree", () => {
    const seed = pickSeed();
    const rng = makeRng(seed);
    for (let i = 0; i < 10_000; i++) {
      const req = {
        "if-none-match": maybe(rng, FRESH_ATOMS),
        "if-modified-since": maybe(rng, FRESH_ATOMS),
        "cache-control": maybe(rng, FRESH_ATOMS),
      };
      const res = { etag: maybe(rng, FRESH_ATOMS), "last-modified": maybe(rng, FRESH_ATOMS) };
      assert.equal(
        fresh(req, res),
        oracleFresh(req, res),
        `${JSON.stringify({ req, res })} (SEED=${seed})`,
      );
    }
  });

  test("range: 10,000 generated headers agree, with and without combine", () => {
    const seed = pickSeed();
    const rng = makeRng(seed);
    for (let i = 0; i < 10_000; i++) {
      const header = build(rng, RANGE_ATOMS, 12);
      const size = rng.pick([0, 1, 10, 100, 1000]);
      const combine = rng.int(2) === 0;
      const mine = parseRange(size, header, { combine });
      const theirs = oracleRange(size, header, { combine });
      const norm = (r: any) => (typeof r === "number" ? r : { type: r.type, ranges: [...r] });
      assert.deepEqual(
        norm(mine),
        norm(theirs),
        `${JSON.stringify(header)} size=${size} combine=${combine} (SEED=${seed})`,
      );
    }
  });

  test("long inputs finish in linear-looking time", () => {
    const sizes = [1_000, 10_000, 40_000];
    const times = sizes.map((n) => {
      const inm = '"abc",'.repeat(n / 6);
      const cc = "no-cachex,".repeat(n / 10);
      const range = "bytes=" + "0-5,".repeat(n / 4);
      const t0 = performance.now();
      fresh({ "if-none-match": inm, "cache-control": cc }, { etag: '"zzz"' });
      parseRange(1000, range, { combine: true });
      return performance.now() - t0;
    });
    const ratio = (times[2] as number) / Math.max(times[0] as number, 0.5);
    assert.ok(ratio < 120, `times ${times.map((t) => t.toFixed(1)).join(" / ")} ms`);
  });
});

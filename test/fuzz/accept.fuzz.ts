/**
 * Seeded fuzz for the four negotiators: 10k generated headers per family,
 * byte-parity with `negotiator@0.6.3` on every call, plus the hardening
 * properties — never throws, never blows past linear time.
 *
 * The generator is weighted toward what breaks parsers: unbalanced quotes,
 * stray separators, Unicode whitespace (JS `\s` is wider than ASCII), line
 * terminators (which negotiator's `.` refuses), malformed q-values, empty
 * pieces, and case games. Replay any failure with SEED=<n>.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, test } from "node:test";
import {
  preferredCharsets,
  preferredEncodings,
  preferredLanguages,
  preferredMediaTypes,
} from "../../lib/negotiation/index.js";
import { makeRng, pickSeed } from "./rng.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const Negotiator = createRequire(import.meta.url)("negotiator") as any;

const ATOMS = [
  "text",
  "html",
  "application",
  "json",
  "*",
  "en",
  "US",
  "fr",
  "gzip",
  "identity",
  "utf-8",
  "br",
  "/",
  "-",
  ",",
  ";",
  "=",
  "q",
  "q=0.5",
  "q=1",
  "q=0",
  "q=",
  "q=abc",
  "q=0.5abc",
  "q=.5",
  "level=1",
  "charset=utf-8",
  '"',
  '"a,b"',
  " ",
  "\t",
  " ",
  "\n",
  "\r\n",
  " ",
  "﻿",
  "TEXT",
  "Html",
  "x",
  "1",
  ".",
];

const PROVIDED = [
  undefined,
  [],
  ["text/html"],
  ["application/json", "text/html"],
  ["text/html;level=1", "text/plain"],
  ["gzip", "identity"],
  ["identity"],
  ["en", "en-US", "fr"],
  ["utf-8", "iso-8859-1"],
  ["*"],
  ["TEXT/HTML"],
  ["not a type", "text/html"],
];

function build(rng: ReturnType<typeof makeRng>): string {
  let out = "";
  const n = 1 + rng.int(14);
  for (let i = 0; i < n; i++) out += rng.pick(ATOMS);
  return out;
}

const FAMILIES: Array<{
  name: string;
  header: string;
  mine: (h: string | undefined, p?: readonly string[]) => string[];
  theirs: (n: any, p?: readonly string[]) => string[];
}> = [
  {
    name: "Accept",
    header: "accept",
    mine: preferredMediaTypes,
    theirs: (n, p) => n.mediaTypes(p),
  },
  {
    name: "Accept-Encoding",
    header: "accept-encoding",
    mine: preferredEncodings,
    theirs: (n, p) => n.encodings(p),
  },
  {
    name: "Accept-Language",
    header: "accept-language",
    mine: preferredLanguages,
    theirs: (n, p) => n.languages(p),
  },
  {
    name: "Accept-Charset",
    header: "accept-charset",
    mine: preferredCharsets,
    theirs: (n, p) => n.charsets(p),
  },
];

describe("negotiation fuzz: parity with negotiator on generated input", () => {
  for (const family of FAMILIES) {
    test(`${family.name}: 10,000 generated headers agree`, () => {
      const seed = pickSeed();
      const rng = makeRng(seed);
      for (let i = 0; i < 10_000; i++) {
        const header = rng.int(50) === 0 ? undefined : build(rng);
        const provided = rng.pick(PROVIDED);
        const negotiator = new Negotiator({
          headers: header === undefined ? {} : { [family.header]: header },
        });
        let theirs: string[];
        try {
          theirs = family.theirs(negotiator, provided);
        } catch {
          // negotiator threw: ours must still produce a defined result.
          assert.doesNotThrow(() => family.mine(header, provided));
          continue;
        }
        assert.deepEqual(
          family.mine(header, provided),
          theirs,
          `${family.name} ${JSON.stringify(header)} / ${JSON.stringify(provided)} (SEED=${seed})`,
        );
      }
    });
  }

  test("long random headers finish in linear-looking time", () => {
    const seed = pickSeed();
    const rng = makeRng(seed);
    const sizes = [1_000, 10_000, 40_000];
    const times = sizes.map((size) => {
      let header = "";
      while (header.length < size) header += rng.pick(ATOMS);
      const t0 = performance.now();
      for (const family of FAMILIES) family.mine(header, ["text/html", "gzip", "en", "utf-8"]);
      return performance.now() - t0;
    });
    // 40x the input must not cost more than ~120x the time (generous, but a
    // quadratic blowup would be thousands of x).
    const ratio = (times[2] as number) / Math.max(times[0] as number, 0.5);
    assert.ok(ratio < 120, `times ${times.map((t) => t.toFixed(1)).join(" / ")} ms (SEED=${seed})`);
  });
});

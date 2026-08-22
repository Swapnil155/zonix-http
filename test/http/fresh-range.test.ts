/**
 * `http/fresh.ts` and `http/range.ts` verified differentially against their
 * pinned originals, `fresh@0.5.2` and `range-parser@1.2.1` (rule 8). Nothing
 * in `lib/` imports either package; they are oracles only.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, test } from "node:test";
import { fresh, parseTokenList } from "../../lib/http/fresh.js";
import { parseRange } from "../../lib/http/range.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const require = createRequire(import.meta.url);
const oracleFresh = require("fresh") as (a: any, b: any) => boolean;
const oracleRange = require("range-parser") as (s: number, r: string, o?: any) => any;

const ETAGS = [undefined, "", '"abc"', 'W/"abc"', '"xyz"', "abc", '"a,b"'];
const NONE_MATCH = [
  undefined,
  "",
  "*",
  '"abc"',
  'W/"abc"',
  '"xyz"',
  '"xyz", "abc"',
  '"xyz",W/"abc"',
  ' "abc" ',
  '"abc",',
  ',"abc"',
  '"a,b"',
  '\t"abc"',
  '"abc"\t',
  "W/*",
  "abc",
];
const DATES = [
  undefined,
  "",
  "Sat, 01 Jan 2000 00:00:00 GMT",
  "Sat, 01 Jan 2000 00:00:01 GMT",
  "Fri, 31 Dec 1999 23:59:59 GMT",
  "not a date",
  "0",
  "2000-01-01",
  "Sat, 01 Jan 2000 00:00:00 +0100",
];
const CACHE_CONTROL = [
  undefined,
  "",
  "no-cache",
  "max-age=0",
  "max-age=0, no-cache",
  "no-cache, max-age=0",
  " no-cache ",
  "no-cachex",
  "xno-cache",
  "no-cache=1",
  "NO-CACHE",
  "no-store",
  "public,no-cache",
  "no-cache\t",
  " no-cache",
  "no-cache ,",
];

describe("fresh: differential against fresh@0.5.2", () => {
  test("every If-None-Match x ETag x Cache-Control agrees", () => {
    for (const noneMatch of NONE_MATCH) {
      for (const etag of ETAGS) {
        for (const cc of CACHE_CONTROL) {
          const req = { "if-none-match": noneMatch, "cache-control": cc };
          const res = { etag };
          assert.equal(
            fresh(req, res),
            oracleFresh(req, res),
            `inm=${JSON.stringify(noneMatch)} etag=${JSON.stringify(etag)} cc=${JSON.stringify(cc)}`,
          );
        }
      }
    }
  });

  test("every If-Modified-Since x Last-Modified agrees, alone and with ETags", () => {
    for (const ims of DATES) {
      for (const lm of DATES) {
        for (const noneMatch of [undefined, "*", '"abc"', '"zzz"']) {
          const req = { "if-modified-since": ims, "if-none-match": noneMatch };
          const res = { "last-modified": lm, etag: '"abc"' };
          assert.equal(
            fresh(req, res),
            oracleFresh(req, res),
            `ims=${JSON.stringify(ims)} lm=${JSON.stringify(lm)} inm=${JSON.stringify(noneMatch)}`,
          );
        }
      }
    }
  });

  test("the landmine: If-None-Match: * is unconditional, even with no validator", () => {
    assert.equal(fresh({ "if-none-match": "*" }, {}), true);
    assert.equal(oracleFresh({ "if-none-match": "*" }, {}), true);
    assert.equal(fresh({ "if-none-match": '"x"' }, {}), false);
  });

  test("token list splitting matches the oracle's quirks (tabs are token bytes)", () => {
    assert.deepEqual(parseTokenList('"a", "b",  "c"'), ['"a"', '"b"', '"c"']);
    assert.deepEqual(parseTokenList('\t"a"'), ['\t"a"']);
    assert.deepEqual(parseTokenList(""), [""]);
    assert.deepEqual(parseTokenList(","), ["", ""]);
  });
});

const SIZES = [0, 1, 10, 100, 1000];
const RANGES = [
  "",
  "bytes",
  "bytes=",
  "bytes=0-",
  "bytes=0-0",
  "bytes=0-9",
  "bytes=-5",
  "bytes=5-",
  "bytes=-0",
  "bytes=0-1000",
  "bytes=1000-2000",
  "bytes=9-5",
  "bytes=-",
  "bytes=a-b",
  "bytes=1abc-5",
  "bytes=0-5,10-20",
  "bytes=0-5,3-8",
  "bytes=0-5,6-10",
  "bytes=10-20,0-5",
  "bytes=0-5, 10-20",
  "bytes=0-5,,10-20",
  "bytes=0-1-2",
  "bytes=0-5,x",
  "items=0-5",
  "=0-5",
  "bytes=0-5=6",
  "bytes=5-5,5-5",
  "bytes=-100,0-1",
  "bytes=0-99,-1",
  "bytes= 0 - 5",
  "bytes=0x1-5",
  "bytes=-5-",
];

describe("range: differential against range-parser@1.2.1", () => {
  test("every header x size agrees, with and without combine", () => {
    for (const size of SIZES) {
      for (const header of RANGES) {
        for (const combine of [false, true]) {
          const mine = parseRange(size, header, { combine });
          const theirs = oracleRange(size, header, { combine });
          assert.deepEqual(
            typeof mine === "number" ? mine : [...mine],
            typeof theirs === "number" ? theirs : [...theirs],
            `size=${size} header=${JSON.stringify(header)} combine=${combine}`,
          );
          if (typeof mine !== "number") assert.equal(mine.type, theirs.type);
        }
      }
    }
  });

  test("return codes: -2 malformed, -1 unsatisfiable, ranges otherwise", () => {
    assert.equal(parseRange(100, "bytes"), -2);
    assert.equal(parseRange(100, "bytes=500-600"), -1);
    const r = parseRange(100, "bytes=0-9");
    assert.notEqual(typeof r, "number");
    if (typeof r !== "number") {
      assert.equal(r.type, "bytes");
      assert.deepEqual([...r], [{ start: 0, end: 9 }]);
    }
  });
});

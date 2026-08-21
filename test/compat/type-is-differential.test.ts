/**
 * `req.is()` verified differentially against the real `type-is` package.
 *
 * Structure rule 2 pairs each inlined module with the package it replaces, and
 * rule 8 makes the differential mandatory. This one is not theoretical: the
 * hand-written unit tests asserted that `req.is("application/*")` returns the
 * pattern `"application/*"`, because that is what the Express documentation
 * says. `type-is` returns the *matched* type — `"application/json"` — and the
 * Phase 6 exit test caught it against real Express. The docs are wrong, the
 * package is the oracle, and this file is what keeps us pinned to the package.
 *
 * `type-is@1.6.18` is a devDependency, pinned exactly. Nothing in `lib/`
 * imports it.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, test } from "node:test";
import { typeIs } from "../../lib/compat/request.js";
import { makeRng, pickSeed } from "../fuzz/rng.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const typeis = createRequire(import.meta.url)("type-is") as (req: any, types: string[]) => unknown;

/**
 * A body-carrying request. `type-is` takes the request; our `typeIs` takes the
 * headers directly (it is a pure function, per the compat/ split), so each side
 * gets the shape it expects.
 */
const headersOf = (contentType: string): any => ({
  "content-type": contentType,
  "content-length": "2",
});
const withBody = (contentType: string): any => ({ headers: headersOf(contentType) });

/** Content types weighted toward the shapes that break naive matchers. */
const TYPES = [
  "application/json",
  "application/json; charset=utf-8",
  "APPLICATION/JSON",
  "application/vnd.api+json",
  "application/ld+json",
  "text/html",
  "text/html; charset=iso-8859-1",
  "text/plain",
  "application/x-www-form-urlencoded",
  "multipart/form-data; boundary=----abc",
  "image/png",
  "application/octet-stream",
  "application/xml",
  "text/xml",
  "application/atom+xml",
];

/** Patterns a real handler would pass to req.is(). */
const PATTERNS = [
  "json",
  "html",
  "text",
  "xml",
  "urlencoded",
  "multipart",
  "text/*",
  "application/*",
  "*/*",
  "*/json",
  "+json",
  "+xml",
  "application/json",
  "text/html",
  "image/png",
  "application/octet-stream",
];

describe("typeIs: differential against type-is", () => {
  test("every type x every single pattern agrees", () => {
    for (const contentType of TYPES) {
      for (const pattern of PATTERNS) {
        const mine = typeIs(headersOf(contentType), [pattern]);
        const theirs = typeis(withBody(contentType), [pattern]);
        assert.equal(
          mine,
          theirs,
          `is(${JSON.stringify(contentType)}, ${JSON.stringify(pattern)})`,
        );
      }
    }
  });

  test("multi-pattern calls agree, including which one wins", () => {
    // The first matching pattern wins, so ordering is part of the contract.
    const lists = [
      ["html", "json"],
      ["json", "html"],
      ["*/*", "json"],
      ["json", "*/*"],
      ["+json", "json"],
      ["json", "+json"],
      ["text/*", "application/*"],
      ["nope", "alsonope", "json"],
    ];
    for (const contentType of TYPES) {
      for (const list of lists) {
        assert.equal(
          typeIs(headersOf(contentType), list),
          typeis(withBody(contentType), list),
          `is(${JSON.stringify(contentType)}, ${JSON.stringify(list)})`,
        );
      }
    }
  });

  test("a request with no body is null for both, whatever is asked", () => {
    for (const pattern of PATTERNS) {
      assert.equal(typeIs({}, [pattern]), null);
      assert.equal(typeis({ headers: {} } as any, [pattern]), null);
    }
  });

  test("a malformed content-type agrees", () => {
    for (const contentType of ["", "   ", "/", "json", "application/", "/json", ";;;", "a/b/c"]) {
      assert.equal(
        typeIs(headersOf(contentType), ["json", "*/*"]),
        typeis(withBody(contentType), ["json", "*/*"]),
        JSON.stringify(contentType),
      );
    }
  });

  test("fuzz: 4000 generated type/pattern pairs agree", () => {
    const seed = pickSeed();
    const rng = makeRng(seed);
    const pool = [
      ..."abcxyz019",
      "/",
      "*",
      "+",
      "-",
      ".",
      ";",
      " ",
      "=",
      "application",
      "text",
      "json",
      "xml",
      "html",
      "charset",
    ];

    for (let i = 0; i < 4000; i++) {
      const build = (): string => {
        let out = "";
        const length = 1 + rng.int(5);
        for (let c = 0; c < length; c++) out += rng.pick(pool);
        return out;
      };
      const contentType = rng.int(2) === 0 ? build() : rng.pick(TYPES);
      const pattern = rng.int(2) === 0 ? build() : rng.pick(PATTERNS);

      let theirs: unknown;
      try {
        theirs = typeis(withBody(contentType), [pattern]);
      } catch {
        // type-is throws on some malformed patterns; ours must not crash the
        // request, so a defined result is the requirement rather than parity.
        assert.doesNotThrow(() => typeIs(headersOf(contentType), [pattern]));
        continue;
      }
      assert.equal(
        typeIs(headersOf(contentType), [pattern]),
        theirs,
        `is(${JSON.stringify(contentType)}, ${JSON.stringify(pattern)}) — replay with SEED=${seed}`,
      );
    }
  });
});

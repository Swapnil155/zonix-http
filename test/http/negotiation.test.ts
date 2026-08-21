/**
 * Negotiation, verified differentially against `negotiator@0.6.3` — the
 * package Express 4 uses through `accepts`. Rule 8: the oracle decides; where
 * our reading of the RFC and negotiator's behaviour disagree, negotiator wins,
 * because compat is with what Express does, not with what it should do.
 *
 * Nothing in `lib/` imports negotiator; it is a pinned devDependency used only
 * here and in the fuzz suite.
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

/* eslint-disable @typescript-eslint/no-explicit-any */
const Negotiator = createRequire(import.meta.url)("negotiator") as any;

const oracle = (header: string | undefined, name: string) =>
  new Negotiator({ headers: header === undefined ? {} : { [name]: header } });

// --- corpora -----------------------------------------------------------------

const ACCEPT = [
  undefined,
  "",
  "*/*",
  "text/html",
  "text/*",
  "text/html, application/json",
  "text/*;q=0.3, text/html;q=0.7, text/html;level=1, text/html;level=2;q=0.4, */*;q=0.5",
  "application/json;q=0.9, text/html;q=0.8, */*;q=0.1",
  "text/html;q=0, */*",
  "text/html;q=0",
  "application/*;q=0.5, text/plain",
  "text/html;charset=utf-8",
  'text/html;charset="utf-8"',
  "text/html; charset=UTF-8; level=1",
  "text/html;level=*",
  'text/plain;foo="a,b";q=0.5, text/html',
  "TEXT/HTML",
  "text/html;q=0.5abc",
  "text/html;q=",
  "text/html;q=abc",
  "text/html;Q=0.5",
  "text/html ; q=0.5",
  " text/html , application/json ",
  "text/html,,application/json",
  "text",
  "/html",
  "text/",
  "text/html/extra",
  "text/html\tapplication/json",
  "text/html;q=1.5",
  "text/html;q=-1",
  "text/html;q=0.0001",
  "text/html;q=.5",
  "a/b;x, c/d;y=1, */*;q=0.2",
];

const PROVIDED_MEDIA: Array<readonly string[] | undefined> = [
  undefined,
  ["text/html"],
  ["application/json", "text/html"],
  ["text/html", "application/json"],
  ["text/plain", "text/html;level=1", "text/html;level=2"],
  ["text/html;charset=utf-8"],
  ["TEXT/HTML"],
  ["image/png"],
  ["text/html", "text/html"],
  [],
  ["not a type"],
  [" text/html "],
];

const ENCODING = [
  undefined,
  "",
  "*",
  "gzip",
  "gzip, deflate",
  "gzip, deflate, br",
  "gzip;q=1.0, identity; q=0.5, *;q=0",
  "gzip, compress;q=0.2, identity;q=0.5",
  "identity;q=0",
  "identity;q=0, *",
  "*;q=0",
  "gzip;q=0.5",
  "gzip;q=0, deflate",
  "GZIP",
  "gzip;q=abc",
  "gzip ;q=0.8 , br",
  "gzip;q=0.8;level=9",
  "br;q=1, gzip;q=1",
  ",,,",
  "gzip;q=0.5abc",
];

const PROVIDED_ENC: Array<readonly string[] | undefined> = [
  undefined,
  ["gzip"],
  ["identity"],
  ["gzip", "identity"],
  ["identity", "gzip"],
  ["br", "gzip", "deflate"],
  ["GZIP"],
  ["bogus"],
  [],
];

const LANGUAGE = [
  undefined,
  "",
  "*",
  "en",
  "en-US",
  "en-US, en;q=0.8",
  "en;q=0.8, es, pt",
  "fr-CA, fr;q=0.8, en-US;q=0.6, en;q=0.4, *;q=0.1",
  "en-US;q=0",
  "en;q=0, *",
  "EN-us",
  "en-",
  "-en",
  "en-US-x-custom",
  "en;q=0.5;q=0.9",
  "en; q=0.5",
  "en;q=.5",
  "en-US;q=abc",
  "zh-Hant-TW, zh;q=0.5",
  "es,,fr",
];

const PROVIDED_LANG: Array<readonly string[] | undefined> = [
  undefined,
  ["en"],
  ["en-US"],
  ["en", "en-US"],
  ["en-US", "en"],
  ["fr", "en", "es"],
  ["EN-US"],
  ["de"],
  ["en-US-x-custom"],
  [],
];

const CHARSET = [
  undefined,
  "",
  "*",
  "utf-8",
  "utf-8, iso-8859-1;q=0.5",
  "iso-8859-1;q=0.5, *;q=0.1",
  "utf-8;q=0",
  "UTF-8",
  "utf-8;q=abc",
  "utf-8 ; q=0.5",
  "utf-8;q=0.5;x=1",
  ",utf-8,",
];

const PROVIDED_CHARSET: Array<readonly string[] | undefined> = [
  undefined,
  ["utf-8"],
  ["iso-8859-1", "utf-8"],
  ["UTF-8"],
  ["ascii"],
  [],
];

// --- differential ------------------------------------------------------------

describe("negotiation: differential against negotiator@0.6.3", () => {
  test("Accept — every header x every provided list agrees", () => {
    for (const header of ACCEPT) {
      for (const provided of PROVIDED_MEDIA) {
        const theirs = oracle(header, "accept").mediaTypes(provided);
        const mine = preferredMediaTypes(header, provided);
        assert.deepEqual(
          mine,
          theirs,
          `Accept ${JSON.stringify(header)} / ${JSON.stringify(provided)}`,
        );
      }
    }
  });

  test("Accept-Encoding — every header x every provided list agrees", () => {
    for (const header of ENCODING) {
      for (const provided of PROVIDED_ENC) {
        const theirs = oracle(header, "accept-encoding").encodings(provided);
        const mine = preferredEncodings(header, provided);
        assert.deepEqual(
          mine,
          theirs,
          `Accept-Encoding ${JSON.stringify(header)} / ${JSON.stringify(provided)}`,
        );
      }
    }
  });

  test("Accept-Language — every header x every provided list agrees", () => {
    for (const header of LANGUAGE) {
      for (const provided of PROVIDED_LANG) {
        const theirs = oracle(header, "accept-language").languages(provided);
        const mine = preferredLanguages(header, provided);
        assert.deepEqual(
          mine,
          theirs,
          `Accept-Language ${JSON.stringify(header)} / ${JSON.stringify(provided)}`,
        );
      }
    }
  });

  test("Accept-Charset — every header x every provided list agrees", () => {
    for (const header of CHARSET) {
      for (const provided of PROVIDED_CHARSET) {
        const theirs = oracle(header, "accept-charset").charsets(provided);
        const mine = preferredCharsets(header, provided);
        assert.deepEqual(
          mine,
          theirs,
          `Accept-Charset ${JSON.stringify(header)} / ${JSON.stringify(provided)}`,
        );
      }
    }
  });
});

// --- the properties worth stating in words -----------------------------------

describe("negotiation: properties the wiring relies on", () => {
  test("no Accept header accepts everything; an empty one accepts nothing", () => {
    assert.deepEqual(preferredMediaTypes(undefined, ["text/html"]), ["text/html"]);
    assert.deepEqual(preferredMediaTypes("", ["text/html"]), []);
  });

  test("specificity beats order: a more specific range wins at equal q", () => {
    assert.deepEqual(preferredMediaTypes("text/*, text/html", ["text/plain", "text/html"]), [
      "text/html",
      "text/plain",
    ]);
  });

  test("q=0 is a veto, even against */*", () => {
    assert.deepEqual(preferredMediaTypes("text/html;q=0, */*", ["text/html", "image/png"]), [
      "image/png",
    ]);
  });

  test("identity is implied at the lowest quality seen, and identity;q=0 forbids it", () => {
    assert.deepEqual(preferredEncodings("gzip;q=0.5", ["identity", "gzip"]), ["gzip", "identity"]);
    assert.deepEqual(preferredEncodings("gzip, identity;q=0", ["identity", "gzip"]), ["gzip"]);
    assert.deepEqual(preferredEncodings(undefined, ["gzip", "identity"]), ["identity"]);
  });

  test("a language prefix accepts its regions, and vice versa at lower specificity", () => {
    assert.deepEqual(preferredLanguages("en", ["en-US", "fr"]), ["en-US"]);
    assert.deepEqual(preferredLanguages("en-US", ["en", "fr"]), ["en"]);
    assert.deepEqual(preferredLanguages("en-US, en;q=0.8", ["en", "en-US"]), ["en-US", "en"]);
  });

  test("matching is case-insensitive on types, encodings, languages and charsets", () => {
    assert.deepEqual(preferredMediaTypes("TEXT/HTML", ["text/html"]), ["text/html"]);
    assert.deepEqual(preferredEncodings("GZIP", ["gzip"]), ["gzip"]);
    assert.deepEqual(preferredLanguages("EN-us", ["en-US"]), ["en-US"]);
    assert.deepEqual(preferredCharsets("UTF-8", ["utf-8"]), ["utf-8"]);
  });

  test("pathological inputs stay linear: 20k entries in well under a second", () => {
    const header = Array.from({ length: 20_000 }, (_, i) => `type${i}/sub;q=0.${i % 9}`).join(",");
    const quotes = `text/html;p="${'"'.repeat(20_000)}`;
    const t0 = performance.now();
    preferredMediaTypes(header, ["type1/sub", "image/png"]);
    preferredMediaTypes(quotes, ["text/html"]);
    preferredEncodings("gzip,".repeat(20_000), ["gzip"]);
    preferredLanguages("en-US,".repeat(20_000), ["en"]);
    preferredCharsets("utf-8,".repeat(20_000), ["utf-8"]);
    const ms = performance.now() - t0;
    assert.ok(ms < 1000, `took ${ms.toFixed(0)} ms`);
  });
});

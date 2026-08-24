import assert from "node:assert/strict";
import { describe, test } from "node:test";
import oracleCookieParser from "cookie-parser";
import { parseCookieHeader, splitCookies } from "../../lib/cookies/parse.js";
import { sign, markSigned } from "../../lib/cookies/sign.js";
import "../helpers/tripwire.js";

const SECRET = "keyboard cat";

/** Run the real cookie-parser middleware over a bare request shape. */
function oracle(
  header: string | undefined,
  secret?: string | string[],
): { cookies: Record<string, unknown>; signed: Record<string, unknown> } {
  const middleware = oracleCookieParser(secret);
  const req = { headers: header === undefined ? {} : { cookie: header } } as never as {
    cookies: Record<string, unknown>;
    signedCookies: Record<string, unknown>;
  };
  middleware(req as never, {} as never, () => undefined);
  return { cookies: { ...req.cookies }, signed: { ...req.signedCookies } };
}

function ours(
  header: string | undefined,
  secret?: string | string[],
): { cookies: Record<string, unknown>; signed: Record<string, unknown> } {
  if (header === undefined) return { cookies: {}, signed: {} };
  const secrets = secret === undefined ? [] : typeof secret === "string" ? [secret] : secret;
  const { cookies, signed } = splitCookies(parseCookieHeader(header), secrets);
  return { cookies: { ...cookies }, signed: { ...signed } };
}

const wire = (value: string, secret = SECRET): string =>
  encodeURIComponent(markSigned(sign(value, secret)));

/** [description, header, secret?] */
const CORPUS: [string, string | undefined, (string | string[])?][] = [
  ["plain pair", "a=1", SECRET],
  ["several pairs", "a=1; b=two; c=%20spaced", SECRET],
  ["valid signed", `session=${wire("user42")}`, SECRET],
  ["signed among plain", `a=1; session=${wire("user42")}; b=2`, SECRET],
  ["tampered signature", `session=${wire("user42", "other")}`, SECRET],
  ["signed, no secret configured", `session=${wire("user42")}`, undefined],
  ["secret rotation array", `session=${wire("u", "old")}`, ["new", "old"]],
  ["rotation, none match", `session=${wire("u", "gone")}`, ["new", "old"]],
  ["json cookie", `prefs=${encodeURIComponent('j:{"a":[1,2]}')}`, SECRET],
  ["signed json cookie", `cart=${wire('j:["x"]')}`, SECRET],
  ["broken json cookie", `b=${encodeURIComponent("j:{nope")}`, SECRET],
  ["bare s: with no dot", "session=s%3Anodothere", SECRET],
  ["s: empty value with signature shape", `x=${encodeURIComponent("s:.abc")}`, SECRET],
  ["duplicate names, first wins", "dup=one; dup=two", SECRET],
  ["value containing equals", "token=a=b=c", SECRET],
  ["quoted value", 'q="hello world"', SECRET],
  ["malformed percent", "broke=%E0%A4%A; ok=1", SECRET],
  ["empty value", "empty=; other=x", SECRET],
  ["no equals segment", "flagonly; real=1", SECRET],
  ["whitespace around pairs", "  a = 1 ;  b= 2 ", SECRET],
  ["utf8 value", `emoji=${encodeURIComponent("héllo✓")}`, SECRET],
  ["no header at all", undefined, SECRET],
];

describe("cookie-parser oracle differential (pinned 1.4.7)", () => {
  for (const [name, header, secret] of CORPUS) {
    test(name, () => {
      assert.deepEqual(ours(header, secret), oracle(header, secret));
    });
  }

  test("fuzz: random cookie headers agree with the oracle", () => {
    // mulberry32, seed printed on failure per the test plan.
    const seed = 0xc00c1e;
    let state = seed;
    const rand = (): number => {
      state |= 0;
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)] as T;
    // "__proto__" and "" excluded from names: documented deviations, asserted below.
    const NAMES = ["a", "b", "session", "constructor", "x-y", " sp "];
    const VALUES = [
      "1",
      "",
      "%20",
      "%E0%A4%A",
      '"quoted"',
      "a=b",
      "j:{}",
      "j:{bad",
      "s:orphan",
      wire("ok"),
      wire("ok", "wrong"),
      encodeURIComponent("héllo"),
    ];
    for (let i = 0; i < 2000; i++) {
      const pairs = Array.from(
        { length: 1 + Math.floor(rand() * 4) },
        () => `${pick(NAMES)}=${pick(VALUES)}`,
      );
      const header = pairs.join(pick(["; ", ";", " ; "]));
      const secret = pick([SECRET, undefined, ["r1", SECRET]] as const);
      try {
        assert.deepEqual(ours(header, secret as never), oracle(header, secret as never));
      } catch (err) {
        console.error(`fuzz seed ${seed} iteration ${i} header ${JSON.stringify(header)}`);
        throw err;
      }
    }
  });

  // Documented deviations, asserted in both directions so a silent change in
  // either implementation fails loudly:
  test("deviation: a cookie named __proto__ - the oracle drops it, we keep it as inert data", () => {
    assert.deepEqual(oracle("__proto__=evil; a=1", SECRET).cookies, { a: "1" });
    assert.deepEqual(ours("__proto__=evil; a=1", SECRET).cookies, {
      ["__proto__"]: "evil",
      a: "1",
    });
    assert.equal(({} as Record<string, unknown>)["evil"], undefined); // nothing polluted
  });

  test("deviation: an empty cookie name - the oracle keeps it, we drop it", () => {
    assert.deepEqual(oracle("=orphan; a=1", SECRET).cookies, { "": "orphan", a: "1" });
    assert.deepEqual(ours("=orphan; a=1", SECRET).cookies, { a: "1" });
  });
});

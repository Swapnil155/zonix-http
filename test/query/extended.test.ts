/**
 * `query/extended.ts` vs the pinned `qs@6.15.3` (rule 8), then the
 * pollution suite for the parts where our posture is deliberately stricter
 * than the oracle's defaults (decision 10).
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, test } from "node:test";
import { ErrorCode } from "../../lib/index.js";
import { parseExtendedQuery } from "../../lib/query/extended.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const qs = createRequire(import.meta.url)("qs") as { parse: (s: string, o?: any) => any };

/** Structure-only view: prototypes differ by design (ours are null). */
const shape = (v: unknown): unknown => JSON.parse(JSON.stringify(v));

const CORPUS: string[] = [
  "",
  "a=1",
  "a=1&b=2",
  "a=1&a=2",
  "a=1&a=2&a=3",
  "a[]=1&a[]=2",
  "a[0]=1&a[1]=2",
  "a[1]=1&a[0]=2",
  "a[5]=x",
  "a[19]=x",
  "a[20]=x",
  "a[21]=x&a[22]=y",
  "a[]=1&a[5]=2",
  "a[b]=1",
  "a[b][c]=1",
  "a[b][c][d][e][f]=1",
  "a[b][c][d][e][f][g]=1",
  "a[b][c][d][e][f][g][h][i]=deep",
  "a[b]=1&a[c]=2",
  "a[b]=1&a=2",
  "a=1&a[b]=2",
  "a[]=1&a=2",
  "a=1&a[]=2",
  "a[b][]=1&a[b][]=2",
  "a[b][0]=x&a[b][1]=y&a[b][c]=z",
  "a[]=x&a[]=y&a[]=z&a[][b]=1",
  "a[0][b]=1&a[0][c]=2",
  "a[0][b]=1&a[1][b]=2",
  "a%5Bb%5D=1",
  "a%5bb%5d=1",
  "a%5Bb=1",
  "a[b=1",
  "a]b=1",
  "a[b]c=1",
  "a[[b]]=1",
  "a[b][=1",
  "[a]=1",
  "[]=1",
  "[][]=1",
  "=1",
  "a",
  "a=",
  "&",
  "&&",
  "a=1&&b=2",
  "a=1&=2",
  "a=b=c",
  "a]=1",
  "a[]]=1",
  "a+b=c+d",
  "a=%20%2B%26",
  "a=%E2%9C%93",
  "a=%E0%A4%A",
  "a=%",
  "a=%zz",
  "%61=%62",
  "a[%5D]=1",
  "a.b=1",
  "a[b.c]=1",
  "a=1,2,3",
  "a[]=1,2",
  "a[toString]=1",
  "a[valueOf]=1",
  "a[hasOwnProperty]=1",
  "toString=1",
  "hasOwnProperty=1",
  "__proto__=1",
  "__proto__[x]=1",
  "a[__proto__]=1",
  "a[__proto__][x]=1",
  "constructor=1",
  "constructor[prototype][x]=1",
  "a[constructor]=1",
  "x=1&__proto__[y]=2&z=3",
  "a[b]=1&a[b]=2",
  "a[b]=1&a[b][c]=2",
  "a[b][c]=1&a[b]=2",
  "a[0]=1&a[0]=2",
  "a[0]=1&a=2",
  "a=1&a[0]=2",
  "a[b]=1&a[0]=2",
  "a[0]=1&a[b]=2",
  "a[]=1&a[]=2&a[]=3&a[]=4&a[]=5&a[]=6&a[]=7&a[]=8&a[]=9&a[]=10&a[]=11&a[]=12&a[]=13&a[]=14&a[]=15&a[]=16&a[]=17&a[]=18&a[]=19&a[]=20&a[]=21",
  "a=1&a=2&a=3&a=4&a=5&a=6&a=7&a=8&a=9&a=10&a=11&a=12&a=13&a=14&a=15&a=16&a=17&a=18&a=19&a=20&a=21&a=22",
  "a[20]=x&a[]=y",
  "a[25]=x&a[]=y&a[]=z",
  "a[25]=x&a=y",
  "a=y&a[25]=x",
  "a[25]=x&a[3]=y",
  "a[3]=y&a[25]=x",
  "a[x]=1&a[25]=x",
  "a[00]=1",
  "a[-1]=1",
  "a[1.5]=1",
  "a[ 1]=1",
  "a[1e2]=1",
  "a[999999999999]=1",
  "utf8=%E2%9C%93&a=1",
  "utf8=%26%2310003%3B&a=%E9",
  "a=1&b[c]=2&b[d][e]=3&b[d][f][]=4&b[d][f][]=5",
  "user[name]=Ada&user[tags][]=x&user[tags][]=y&user[address][city]=London",
];

describe("extended query: differential vs qs@6.15.3", () => {
  for (const input of CORPUS) {
    test(JSON.stringify(input), () => {
      assert.deepEqual(shape(parseExtendedQuery(input)), shape(qs.parse(input)));
    });
  }

  test("depth and arrayLimit options track the oracle", () => {
    for (const depth of [0, 1, 2, 3, 10]) {
      for (const input of ["a[b][c][d]=1", "a[b]=1", "a=1", "[a][b]=1", "a[b][c=1"]) {
        assert.deepEqual(
          shape(parseExtendedQuery(input, { depth })),
          shape(qs.parse(input, { depth })),
          `${input} depth=${depth}`,
        );
      }
    }
    for (const arrayLimit of [0, 1, 3, 100]) {
      for (const input of ["a[]=1&a[]=2&a[]=3&a[]=4", "a[2]=x", "a[1]=x&a[0]=y&a=z"]) {
        assert.deepEqual(
          shape(parseExtendedQuery(input, { arrayLimit })),
          shape(qs.parse(input, { arrayLimit })),
          `${input} arrayLimit=${arrayLimit}`,
        );
      }
    }
  });

  test("parameterLimit truncates like the oracle, or answers 413 when asked", () => {
    const input = Array.from({ length: 12 }, (_, i) => `k${i}=${i}`).join("&");
    assert.deepEqual(
      shape(parseExtendedQuery(input, { parameterLimit: 5 })),
      shape(qs.parse(input, { parameterLimit: 5 })),
    );
    assert.throws(
      () => parseExtendedQuery(input, { parameterLimit: 5, throwOnParameterLimit: true }),
      {
        code: ErrorCode.TOO_MANY_PARAMETERS,
        status: 413,
      },
    );
    // Exactly at the limit is fine.
    const five = Array.from({ length: 5 }, (_, i) => `k${i}=${i}`).join("&");
    assert.equal(
      Object.keys(parseExtendedQuery(five, { parameterLimit: 5, throwOnParameterLimit: true }))
        .length,
      5,
    );
  });

  test("strictDepth answers 400 where the oracle throws RangeError", () => {
    assert.throws(() => qs.parse("a[b][c]=1", { depth: 1, strictDepth: true }), RangeError);
    assert.throws(() => parseExtendedQuery("a[b][c]=1", { depth: 1, strictDepth: true }), {
      code: ErrorCode.QUERY_TOO_DEEP,
      status: 400,
    });
    assert.deepEqual(shape(parseExtendedQuery("a[b]=1", { depth: 1, strictDepth: true })), {
      a: { b: "1" },
    });
  });
});

describe("extended query: pollution posture (decision 10)", () => {
  const POLLUTION = [
    "__proto__[polluted]=1",
    "__proto__=1",
    "a[__proto__][polluted]=1",
    "a[][__proto__][polluted]=1",
    "constructor[prototype][polluted]=1",
    "a[constructor][prototype][polluted]=1",
    "prototype[polluted]=1",
    "a[prototype][polluted]=1",
    "a[b][prototype]=1",
    "%5F%5Fproto%5F%5F[polluted]=1",
    "__proto__%5Bpolluted%5D=1",
    "a[toString]=1",
    "a[hasOwnProperty]=1",
    "a[__defineGetter__]=1",
    "a[b]=1&a[__proto__][polluted]=2&c=3",
  ];

  for (const input of POLLUTION) {
    test(`${JSON.stringify(input)} pollutes nothing and yields null-prototype objects`, () => {
      const out = parseExtendedQuery(input);
      assert.equal(({} as any).polluted, undefined);
      assert.equal(Object.getPrototypeOf(out), null);
      assert.equal(Object.getPrototypeOf({}), Object.prototype);
      const stack: unknown[] = [out];
      while (stack.length) {
        const v = stack.pop();
        if (Array.isArray(v)) stack.push(...v);
        else if (v !== null && typeof v === "object") {
          assert.equal(Object.getPrototypeOf(v), null, JSON.stringify(v));
          for (const k of Object.keys(v)) {
            assert.ok(!["__proto__", "constructor", "prototype"].includes(k), k);
            stack.push((v as any)[k]);
          }
        }
      }
      assert.equal((out as any).__proto__, undefined);
      assert.equal("constructor" in out, false);
    });
  }

  test("ordinary keys around a dropped one survive; `prototype` is dropped even though qs keeps it", () => {
    assert.deepEqual(shape(parseExtendedQuery("a[b]=1&a[__proto__][x]=2&c=3")), {
      a: { b: "1" },
      c: "3",
    });
    assert.deepEqual(shape(qs.parse("a[prototype]=1")), { a: { prototype: "1" } });
    assert.deepEqual(shape(parseExtendedQuery("a[prototype]=1")), {});
    assert.deepEqual(shape(parseExtendedQuery("prototype=1&x=2")), { x: "2" });
    // depth 0 keeps the whole key as one segment; qs then emits `constructor`.
    assert.deepEqual(shape(qs.parse("[constructor]=1", { depth: 0 })), { constructor: "1" });
    assert.deepEqual(shape(parseExtendedQuery("[constructor]=1", { depth: 0 })), {});
  });

  test("the sparse-array guard: a[1000000]=x is a one-key object, never a million-slot array", () => {
    const out = parseExtendedQuery("a[1000000]=x") as any;
    assert.equal(Array.isArray(out.a), false);
    assert.deepEqual(shape(out), { a: { "1000000": "x" } });
    const ok = parseExtendedQuery("a[19]=x") as any;
    assert.equal(Array.isArray(ok.a), true);
    assert.equal(ok.a.length, 1); // compacted
  });

  test("long inputs finish in linear-looking time", () => {
    const sizes = [2_000, 20_000, 80_000];
    const times = sizes.map((n) => {
      const nested = "a" + "[b".repeat(n) + "=1";
      const unterminated = "a" + "[".repeat(n) + "=1";
      const many = Array.from({ length: n / 4 }, (_, i) => `k${i}[x]=${i}`).join("&");
      const t0 = performance.now();
      parseExtendedQuery(nested, { depth: 1000 });
      parseExtendedQuery(unterminated);
      parseExtendedQuery(many, { parameterLimit: Infinity });
      return performance.now() - t0;
    });
    const ratio = (times[2] as number) / Math.max(times[0] as number, 0.5);
    assert.ok(ratio < 200, `times ${times.map((t) => t.toFixed(1)).join(" / ")} ms`);
  });
});

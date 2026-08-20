// Microbenchmark for createSerializer (CLAUDE.md D1).
//
//   npm run micro:serializer
//
// In-process, no I/O, median of interleaved batches — the same discipline as
// bench/micro.ts. Both serializers are checksummed so V8 cannot eliminate them,
// and each payload is verified byte-identical to JSON.stringify before timing,
// so a "win" can never come from producing different output.
import { createSerializer, type Schema } from "../lib/serialize.js";

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  }),
);

interface Case {
  name: string;
  schema: Schema;
  value: unknown;
}

const listItem = {
  type: "object",
  properties: {
    id: { type: "number" },
    name: { type: "string" },
    active: { type: "boolean" },
  },
} as const satisfies Schema;

const CASES: readonly Case[] = [
  {
    name: "hello-world",
    schema: { type: "object", properties: { hello: { type: "string" } } },
    value: { hello: "world" },
  },
  {
    name: "api-object (5 fields)",
    schema: {
      type: "object",
      properties: {
        id: { type: "number" },
        name: { type: "string" },
        email: { type: "string" },
        active: { type: "boolean" },
        createdAt: { type: "string" },
      },
    },
    value: {
      id: 12345,
      name: "Ada Lovelace",
      email: "ada@example.com",
      active: true,
      createdAt: "2026-08-21T00:00:00.000Z",
    },
  },
  {
    name: "list of 20",
    schema: { type: "array", items: listItem },
    value: Array.from({ length: 20 }, (_, i) => ({
      id: i,
      name: `user-${i}`,
      active: i % 2 === 0,
    })),
  },
  {
    name: "strings needing escapes",
    schema: {
      type: "object",
      properties: { title: { type: "string" }, body: { type: "string" } },
    },
    value: { title: 'He said "hi"', body: "line one\nline two\ttabbed — ünicode" },
  },
  {
    name: "nested",
    schema: {
      type: "object",
      properties: {
        id: { type: "number" },
        tags: { type: "array", items: { type: "string" } },
        meta: {
          type: "object",
          properties: { author: { type: "string" }, votes: { type: "number" } },
        },
      },
    },
    value: {
      id: 7,
      tags: ["alpha", "beta", "gamma"],
      meta: { author: "swapnil", votes: 42 },
    },
  },
];

const iterations = Number(args.get("iterations") ?? 500_000);
const repeats = Number(args.get("repeats") ?? 9);

let checksum = 0;

function batch(fn: (v: unknown) => string, value: unknown, n: number): number {
  const start = process.hrtime.bigint();
  for (let i = 0; i < n; i++) checksum += fn(value).length;
  return Number(process.hrtime.bigint() - start);
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return (s.length % 2 ? s[m] : ((s[m - 1] as number) + (s[m] as number)) / 2) as number;
};

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

console.log("");
console.log("| Payload | JSON.stringify ops/s | createSerializer ops/s | speedup |");
console.log("| ------- | -------------------: | ---------------------: | ------: |");

const speedups: number[] = [];

for (const c of CASES) {
  const serialize = createSerializer(c.schema);

  // Parity gate: a faster serializer that emits different bytes is a bug.
  const expected = JSON.stringify(c.value);
  const actual = serialize(c.value);
  if (actual !== expected) {
    console.log(`| ${c.name} | PARITY FAILURE | ${actual} | vs ${expected} |`);
    process.exitCode = 1;
    continue;
  }

  const stringify = (v: unknown) => JSON.stringify(v) as string;
  batch(stringify, c.value, iterations);
  batch(serialize, c.value, iterations);

  const a: number[] = [];
  const b: number[] = [];
  for (let r = 0; r < repeats; r++) {
    if (r % 2 === 0) {
      a.push((iterations / batch(stringify, c.value, iterations)) * 1e9);
      b.push((iterations / batch(serialize, c.value, iterations)) * 1e9);
    } else {
      b.push((iterations / batch(serialize, c.value, iterations)) * 1e9);
      a.push((iterations / batch(stringify, c.value, iterations)) * 1e9);
    }
  }

  const base = median(a);
  const mine = median(b);
  speedups.push(mine / base);
  console.log(`| ${c.name} | ${fmt(base)} | ${fmt(mine)} | ${(mine / base).toFixed(2)}x |`);
}

console.log("");
console.log(
  `median speedup ${median(speedups).toFixed(2)}x · node ${process.version} · ` +
    `${fmt(iterations)} iters x ${repeats} interleaved batches · checksum ${checksum}`,
);

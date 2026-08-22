/**
 * Wire-diff of `urlencoded()` (simple + extended), `raw()` and `text()` and of
 * `queryParser: "extended"` against real Express 4.22.2 + body-parser 1.20.6
 * (rule 8): the same echo routes on both, a corpus of bodies and content
 * types, status + Content-Type + parsed shape compared. Deliberate deviations
 * (prototype keys, `req.body` on skipped requests, inflate) are asserted
 * explicitly at the end.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, describe, test } from "node:test";
import zonix, { raw, text, urlencoded, type Zonix } from "../../lib/index.js";
import { start, type RunningApp } from "../helpers/make-app.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const require = createRequire(import.meta.url);
const express = require("express") as any;
const bodyParser = require("body-parser") as any;

function echo(req: any, res: any): void {
  const body = req.body;
  res.json({
    kind: Buffer.isBuffer(body) ? "buffer" : typeof body,
    body: Buffer.isBuffer(body) ? body.toString("base64") : body === undefined ? null : body,
    query: req.query,
  });
}

function buildZonix(): Zonix {
  const app = zonix({ dev: false, queryParser: "extended" });
  app.post("/simple", urlencoded(), echo);
  app.post("/extended", urlencoded({ extended: true }), echo);
  app.post("/extended-limits", urlencoded({ extended: true, parameterLimit: 3, depth: 2 }), echo);
  app.post("/raw", raw(), echo);
  app.post("/raw-any", raw({ type: "*/*" }), echo);
  app.post("/text", text(), echo);
  app.post("/text-any", text({ type: "text/*" }), echo);
  app.get("/query", echo);
  app.handleErr((err, _req, res) => {
    res.status(err.status ?? 500).json({ status: err.status ?? 500 });
  });
  return app;
}

function buildExpress(): any {
  const app = express();
  app.set("query parser", "extended");
  app.disable("x-powered-by");
  app.disable("etag");
  app.post("/simple", bodyParser.urlencoded({ extended: false }), echo);
  app.post("/extended", bodyParser.urlencoded({ extended: true }), echo);
  app.post(
    "/extended-limits",
    bodyParser.urlencoded({ extended: true, parameterLimit: 3, depth: 2 }),
    echo,
  );
  app.post("/raw", bodyParser.raw(), echo);
  app.post("/raw-any", bodyParser.raw({ type: "*/*" }), echo);
  app.post("/text", bodyParser.text(), echo);
  app.post("/text-any", bodyParser.text({ type: "text/*" }), echo);
  app.get("/query", echo);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.status ?? 500).json({ status: err.status ?? 500 });
  });
  return app;
}

const FORM = "application/x-www-form-urlencoded";

/**
 * body-parser sets `req.body = {}` on every request it skips; zonix leaves it
 * `undefined` (a parser that did not run leaves no trace). Asserted as a
 * deviation below; folded here so everything else still diffs byte-for-byte.
 */
function normalizeSkipped(echoed: any): any {
  if (echoed && echoed.kind === "undefined" && echoed.body === null) {
    return { ...echoed, kind: "object", body: {} };
  }
  return echoed;
}
const BODIES: Array<[string, string | Buffer]> = [
  ["a=1&b=two+words&c=%E2%9C%93", ""],
  ["a=1&a=2&a=3", ""],
  ["a[b]=1&a[c]=2", ""],
  ["user[name]=Ada&user[tags][]=x&user[tags][]=y&user[address][city]=London", ""],
  ["a[0]=x&a[1]=y&a[5]=z", ""],
  ["a[]=1&a[]=2&a=3", ""],
  ["a=1&a[b]=2", ""],
  ["a%5Bb%5D=1", ""],
  ["a[b][c][d][e][f][g][h]=deep", ""],
  ["empty=&flag&x=%", ""],
  ["=1&&a=b=c", ""],
  ["a[120]=x", ""],
  ["", ""],
  ["a=1&b=2&c=3", ""],
  ["a=1&b=2&c=3&d=4", ""],
  ["a[b][c]=1", ""],
  ["a[b][c][d]=1", ""],
].map(([b]) => [b as string, b as string]);

interface Probe {
  path: string;
  type: string;
  body: string | Buffer;
  method?: string;
}

const PROBES: Probe[] = [
  ...BODIES.flatMap(([body]) => [
    { path: "/simple", type: FORM, body },
    { path: "/extended", type: FORM, body },
    { path: "/extended-limits", type: FORM, body },
  ]),
  { path: "/simple", type: `${FORM}; charset=utf-8`, body: "a=1" },
  { path: "/simple", type: `${FORM}; charset=iso-8859-1`, body: "a=1" },
  { path: "/simple", type: "application/json", body: '{"a":1}' },
  { path: "/extended", type: "text/plain", body: "a=1" },
  {
    path: "/raw",
    type: "application/octet-stream",
    body: Buffer.from([0, 1, 2, 255, 0xe2, 0x9c, 0x93]),
  },
  { path: "/raw", type: "text/plain", body: "skipped" },
  { path: "/raw", type: "application/octet-stream", body: "" },
  { path: "/raw-any", type: "application/json", body: '{"a":1}' },
  { path: "/raw-any", type: "text/html", body: "<p>" },
  { path: "/text", type: "text/plain", body: "héllo ✓" },
  { path: "/text", type: "text/plain; charset=utf-8", body: "plain" },
  { path: "/text", type: "text/plain; charset=iso-8859-1", body: Buffer.from("caf\xe9", "latin1") },
  { path: "/text", type: "text/plain; charset=utf-16le", body: Buffer.from("wide ✓", "utf16le") },
  { path: "/text", type: "text/html", body: "<p>" },
  { path: "/text-any", type: "text/html; charset=utf-8", body: "<p>" },
  { path: "/text", type: "text/plain", body: "" },
  {
    path: "/query?a=1&b[c]=2&b[d][]=3&b[d][]=4&e[0]=x&e[1]=y&f=1&f=2",
    type: "",
    body: "",
    method: "GET",
  },
  { path: "/query?a[b][c][d][e][f][g]=deep&x[25]=y&z[]=1", type: "", body: "", method: "GET" },
  { path: "/query?a=%E2%9C%93&b=two+words&c=&d", type: "", body: "", method: "GET" },
  { path: "/query", type: "", body: "", method: "GET" },
];

describe("body parsers + extended query: wire-diff vs Express 4.22.2 + body-parser 1.20.6", () => {
  let mine: RunningApp;
  let theirs: { port: number; close: () => Promise<void> };
  before(async () => {
    mine = await start(buildZonix());
    const server = buildExpress().listen(0, "127.0.0.1");
    await new Promise<void>((r) => server.once("listening", () => r()));
    theirs = {
      port: (server.address() as { port: number }).port,
      close: () => new Promise<void>((r) => server.close(() => r())),
    };
  });
  after(async () => {
    await Promise.all([mine.close(), theirs.close()]);
  });

  async function send(
    port: number,
    p: Probe,
  ): Promise<{ status: number; type: string | null; body: string }> {
    const method = p.method ?? "POST";
    const r = await fetch(`http://127.0.0.1:${port}${p.path}`, {
      method,
      headers: method === "GET" ? {} : { "content-type": p.type },
      body: method === "GET" ? undefined : p.body,
    });
    return { status: r.status, type: r.headers.get("content-type"), body: await r.text() };
  }

  for (const p of PROBES) {
    test(`${p.method ?? "POST"} ${p.path} [${p.type}] ${JSON.stringify(typeof p.body === "string" ? p.body : `<${p.body.length} bytes>`)}`, async () => {
      const [a, b] = await Promise.all([send(mine.port, p), send(theirs.port, p)]);
      assert.equal(a.status, b.status, `status (theirs: ${b.body})`);
      assert.equal(a.type, b.type, "content-type");
      const actual = JSON.parse(a.body);
      // Only a mounted parser can leave body-parser's `{}` behind.
      assert.deepEqual(
        p.method === "GET" ? actual : normalizeSkipped(actual),
        JSON.parse(b.body),
        "body",
      );
    });
  }
});

describe("body parsers: deliberate deviations, asserted", () => {
  test("a skipped request: body-parser leaves {} behind, zonix leaves undefined; koi8-r: iconv vs 415", async () => {
    const mine = await start(buildZonix());
    const server = buildExpress().listen(0, "127.0.0.1");
    await new Promise<void>((r) => server.once("listening", () => r()));
    const port = (server.address() as { port: number }).port;
    try {
      const post = (p: number, path: string, type: string) =>
        fetch(`http://127.0.0.1:${p}${path}`, {
          method: "POST",
          headers: { "content-type": type },
          body: "x",
        }).then(async (r) => ({ status: r.status, body: (await r.json()) as any }));
      const [ours, theirs] = await Promise.all([
        post(mine.port, "/raw", "text/plain"),
        post(port, "/raw", "text/plain"),
      ]);
      assert.deepEqual(
        { kind: ours.body.kind, body: ours.body.body },
        { kind: "undefined", body: null },
      );
      assert.deepEqual(
        { kind: theirs.body.kind, body: theirs.body.body },
        { kind: "object", body: {} },
      );
      const [k1, k2] = await Promise.all([
        post(mine.port, "/text", "text/plain; charset=koi8-r"),
        post(port, "/text", "text/plain; charset=koi8-r"),
      ]);
      assert.equal(k1.status, 415); // decision 1: no iconv-lite
      assert.equal(k2.status, 200);
    } finally {
      await mine.close();
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  test("prototype keys: body-parser/Express keep them (allowPrototypes: true); zonix drops them", async () => {
    const mine = await start(buildZonix());
    const server = buildExpress().listen(0, "127.0.0.1");
    await new Promise<void>((r) => server.once("listening", () => r()));
    const port = (server.address() as { port: number }).port;
    try {
      const post = (p: number) =>
        fetch(`http://127.0.0.1:${p}/extended`, {
          method: "POST",
          headers: { "content-type": FORM },
          body: "a[constructor][x]=1&a[prototype]=2&b=3",
        }).then((r) => r.json() as Promise<any>);
      const [ours, theirs] = await Promise.all([post(mine.port), post(port)]);
      assert.deepEqual(ours.body, { b: "3" });
      assert.deepEqual(theirs.body, { a: { constructor: { x: "1" }, prototype: "2" }, b: "3" });
    } finally {
      await mine.close();
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});

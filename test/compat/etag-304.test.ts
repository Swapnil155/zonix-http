/**
 * Conditional GET on the wire.
 *
 * Part one: raw-socket assertions on zonix alone — generated ETags (app and
 * route level), `If-None-Match` matching in every form (`*`, weak vs strong),
 * `If-Modified-Since`, HEAD, POST, and `sendFile` answering 304 before it
 * reads the file. Part two: the same routes on real Express 4.22.2 with its
 * default (weak) ETag, wire-diffed against `zonix({ etag: "weak" })`.
 */
import assert from "node:assert/strict";
import { mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { after, before, describe, test } from "node:test";
import zonix, { etag, type Zonix } from "../../lib/index.js";
import { start, type RunningApp } from "../helpers/make-app.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const express = createRequire(import.meta.url)("express") as any;

const dir = mkdtempSync(join(tmpdir(), "zonix-etag-"));
const FILE = join(dir, "asset.txt");
writeFileSync(FILE, "static asset body\n");
// A fixed mtime so Last-Modified / stat tags are deterministic across runs.
const MTIME = new Date("2000-01-01T00:00:00Z");
utimesSync(FILE, MTIME, MTIME);

const BODY = { hello: "world", n: 1 };

function defineRoutes(app: any): void {
  app.get("/json", (_req: any, res: any) => res.json(BODY));
  app.get("/text", (_req: any, res: any) => res.send("plain text body"));
  app.get("/file", (_req: any, res: any) => res.sendFile(FILE));
  app.post("/json", (_req: any, res: any) => res.json(BODY));
}

/** Raw request; returns { status, headers, body }. */
function raw(
  port: number,
  method: string,
  path: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  return new Promise((resolve, reject) => {
    const lines = Object.entries(headers).map(([k, v]) => `${k}: ${v}\r\n`);
    const socket = net.connect(port, "127.0.0.1", () => {
      socket.write(
        `${method} ${path} HTTP/1.1\r\nHost: t\r\nConnection: close\r\n${lines.join("")}\r\n`,
      );
    });
    let out = "";
    socket.setEncoding("utf8");
    socket.on("data", (d) => (out += d));
    socket.on("error", reject);
    socket.on("close", () => {
      const [head, ...rest] = out.split("\r\n\r\n");
      const [statusLine, ...headerLines] = (head ?? "").split("\r\n");
      const status = Number((statusLine ?? "").split(" ")[1]);
      const hdrs: Record<string, string> = {};
      for (const line of headerLines) {
        const i = line.indexOf(":");
        if (i > 0) hdrs[line.slice(0, i).toLowerCase()] = line.slice(i + 1).trim();
      }
      resolve({ status, headers: hdrs, body: rest.join("\r\n\r\n") });
    });
  });
}

describe("conditional GET on zonix: generated ETags and 304s", () => {
  let weak: RunningApp;
  let strong: RunningApp;
  let off: RunningApp;
  let routeLevel: RunningApp;

  before(async () => {
    const w: Zonix = zonix({ dev: false, etag: "weak" });
    defineRoutes(w);
    weak = await start(w);
    const s: Zonix = zonix({ dev: false, etag: "strong" });
    defineRoutes(s);
    strong = await start(s);
    const o: Zonix = zonix({ dev: false });
    defineRoutes(o);
    off = await start(o);
    const r: Zonix = zonix({ dev: false });
    r.get("/tagged", etag(), (_req, res) => res.json(BODY));
    r.get("/untagged", (_req, res) => res.json(BODY));
    routeLevel = await start(r);
  });
  after(async () => {
    await Promise.all([weak.close(), strong.close(), off.close(), routeLevel.close()]);
  });

  test("ETag is off by default (rule 4) and on per app or per route", async () => {
    assert.equal((await raw(off.port, "GET", "/json")).headers["etag"], undefined);
    assert.match(
      (await raw(weak.port, "GET", "/json")).headers["etag"] ?? "",
      /^W\/"[0-9a-f]+-[A-Za-z0-9+/]{27}"$/,
    );
    assert.match(
      (await raw(strong.port, "GET", "/json")).headers["etag"] ?? "",
      /^"[0-9a-f]+-[A-Za-z0-9+/]{27}"$/,
    );
    assert.match((await raw(routeLevel.port, "GET", "/tagged")).headers["etag"] ?? "", /^W\/"/);
    assert.equal((await raw(routeLevel.port, "GET", "/untagged")).headers["etag"], undefined);
  });

  test("matching If-None-Match -> 304 with validators kept and body headers dropped", async () => {
    const first = await raw(weak.port, "GET", "/json");
    const tag = first.headers["etag"] as string;
    const r = await raw(weak.port, "GET", "/json", { "If-None-Match": tag });
    assert.equal(r.status, 304);
    assert.equal(r.body, "");
    assert.equal(r.headers["etag"], tag);
    assert.equal(r.headers["content-type"], undefined);
    assert.equal(r.headers["content-length"], undefined);
    assert.equal(r.headers["transfer-encoding"], undefined);
  });

  test("weak and strong forms cross-match; a different tag does not", async () => {
    const weakTag = (await raw(weak.port, "GET", "/json")).headers["etag"] as string;
    const strongTag = (await raw(strong.port, "GET", "/json")).headers["etag"] as string;
    assert.equal("W/" + strongTag, weakTag);
    // strong request tag against a weak response tag
    assert.equal(
      (await raw(weak.port, "GET", "/json", { "If-None-Match": strongTag })).status,
      304,
    );
    // weak request tag against a strong response tag
    assert.equal(
      (await raw(strong.port, "GET", "/json", { "If-None-Match": weakTag })).status,
      304,
    );
    assert.equal((await raw(weak.port, "GET", "/json", { "If-None-Match": '"nope"' })).status, 200);
    // a list with the tag somewhere in it
    assert.equal(
      (await raw(weak.port, "GET", "/json", { "If-None-Match": `"a", ${weakTag}, "b"` })).status,
      304,
    );
  });

  test("If-None-Match: * is unconditional - 304 even when ETags are off", async () => {
    assert.equal((await raw(weak.port, "GET", "/json", { "If-None-Match": "*" })).status, 304);
    assert.equal((await raw(off.port, "GET", "/text", { "If-None-Match": "*" })).status, 304);
  });

  test("only GET and HEAD can be fresh; HEAD 304 carries no body either way", async () => {
    const tag = (await raw(weak.port, "GET", "/json")).headers["etag"] as string;
    assert.equal((await raw(weak.port, "POST", "/json", { "If-None-Match": tag })).status, 200);
    const head = await raw(weak.port, "HEAD", "/json", { "If-None-Match": tag });
    assert.equal(head.status, 304);
    assert.equal(head.body, "");
  });

  test("sendFile: Last-Modified always, weak stat ETag when on, 304 on either validator", async () => {
    const plain = await raw(off.port, "GET", "/file");
    assert.equal(plain.status, 200);
    assert.equal(plain.headers["last-modified"], MTIME.toUTCString());
    assert.equal(plain.headers["etag"], undefined);

    const tagged = await raw(weak.port, "GET", "/file");
    assert.match(tagged.headers["etag"] ?? "", /^W\/"[0-9a-f]+-[0-9a-f]+"$/);
    assert.equal(tagged.body, "static asset body\n");

    const byTag = await raw(weak.port, "GET", "/file", {
      "If-None-Match": tagged.headers["etag"] as string,
    });
    assert.equal(byTag.status, 304);
    assert.equal(byTag.body, "");
    assert.equal(byTag.headers["content-length"], undefined);
    assert.equal(byTag.headers["last-modified"], MTIME.toUTCString());

    const byDate = await raw(off.port, "GET", "/file", {
      "If-Modified-Since": MTIME.toUTCString(),
    });
    assert.equal(byDate.status, 304);
    const older = await raw(off.port, "GET", "/file", {
      "If-Modified-Since": "Fri, 31 Dec 1999 00:00:00 GMT",
    });
    assert.equal(older.status, 200);
    assert.equal(older.headers["content-length"], "18");
  });

  test("a handler-set ETag is respected: not overwritten, and it drives the 304", async () => {
    const app = zonix({ dev: false, etag: "weak" });
    app.get("/own", (_req, res) => {
      res.set("ETag", '"mine"');
      res.json(BODY);
    });
    const running = await start(app);
    try {
      assert.equal((await raw(running.port, "GET", "/own")).headers["etag"], '"mine"');
      assert.equal(
        (await raw(running.port, "GET", "/own", { "If-None-Match": '"mine"' })).status,
        304,
      );
    } finally {
      await running.close();
    }
  });
});

describe("conditional GET: wire-diff against Express 4.22.2 with its default ETag", () => {
  let mine: RunningApp;
  let theirs: { port: number; close: () => Promise<void> };

  before(async () => {
    const z: Zonix = zonix({ dev: false, etag: "weak" });
    defineRoutes(z);
    mine = await start(z);
    const ex = express();
    defineRoutes(ex);
    const server = ex.listen(0, "127.0.0.1");
    await new Promise<void>((r) => server.once("listening", () => r()));
    theirs = {
      port: (server.address() as { port: number }).port,
      close: () => new Promise<void>((r) => server.close(() => r())),
    };
  });
  after(async () => {
    await Promise.all([mine.close(), theirs.close()]);
  });

  const CASES: Array<[string, string, Record<string, string>]> = [
    ["GET", "/json", {}],
    ["GET", "/text", {}],
    ["GET", "/json", { "If-None-Match": "*" }],
    ["GET", "/json", { "If-None-Match": '"nope"' }],
    ["POST", "/json", { "If-None-Match": "*" }],
    ["HEAD", "/json", {}],
  ];

  test("generated tags are identical and 304 decisions agree", async () => {
    for (const [method, path, headers] of CASES) {
      const a = await raw(mine.port, method, path, headers);
      const b = await raw(theirs.port, method, path, headers);
      assert.equal(a.status, b.status, `${method} ${path} ${JSON.stringify(headers)}`);
      assert.equal(a.headers["etag"], b.headers["etag"], `${path} etag`);
      assert.equal(a.body, b.body, `${path} body`);
      assert.equal(a.headers["content-length"], b.headers["content-length"], `${path} length`);
    }
    // Round-trip: each side's own tag yields a 304 from the other side too.
    for (const path of ["/json", "/text"]) {
      const tag = (await raw(theirs.port, "GET", path)).headers["etag"] as string;
      assert.equal((await raw(mine.port, "GET", path, { "If-None-Match": tag })).status, 304);
      assert.equal((await raw(theirs.port, "GET", path, { "If-None-Match": tag })).status, 304);
    }
  });

  test("sendFile: same stat ETag and Last-Modified, same 304 decisions", async () => {
    const a = await raw(mine.port, "GET", "/file");
    const b = await raw(theirs.port, "GET", "/file");
    assert.equal(a.status, 200);
    assert.equal(a.headers["etag"], b.headers["etag"]);
    assert.equal(a.headers["last-modified"], b.headers["last-modified"]);
    assert.equal(a.body, b.body);
    const probes: Record<string, string>[] = [
      { "If-None-Match": b.headers["etag"] as string },
      { "If-Modified-Since": b.headers["last-modified"] as string },
      { "If-Modified-Since": "Fri, 31 Dec 1999 00:00:00 GMT" },
      { "If-None-Match": '"other"' },
    ];
    for (const headers of probes) {
      const x = await raw(mine.port, "GET", "/file", headers);
      const y = await raw(theirs.port, "GET", "/file", headers);
      assert.equal(x.status, y.status, JSON.stringify(headers));
      assert.equal(x.body, y.body);
    }
  });
});

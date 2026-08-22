/**
 * Byte ranges on the wire: `Accept-Ranges`, single-range 206 with
 * `Content-Range`, malformed/multipart → 200 full, unsatisfiable → 416,
 * `If-Range`, HEAD, 412 preconditions, and 304 beating 206 — on both the
 * buffered (≤32KB) and streamed (>32KB) sendFile paths, then wire-diffed
 * against real Express 4.22.2 (`send@0.19.2`).
 */
import assert from "node:assert/strict";
import { mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import zonix, { type Zonix } from "../../lib/index.js";
import { start, type RunningApp } from "../helpers/make-app.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const express = createRequire(import.meta.url)("express") as any;

const dir = mkdtempSync(join(tmpdir(), "zonix-range-"));
const SMALL = join(dir, "small.txt");
const LARGE = join(dir, "large.txt");
const SMALL_BODY = Array.from({ length: 100 }, (_, i) => String(i % 10)).join(""); // 100 bytes
const LARGE_BODY = Buffer.alloc(40_000, "z"); // > 32KB: the streamed path
writeFileSync(SMALL, SMALL_BODY);
writeFileSync(LARGE, LARGE_BODY);
const MTIME = new Date("2000-01-01T00:00:00Z");
utimesSync(SMALL, MTIME, MTIME);
utimesSync(LARGE, MTIME, MTIME);

function defineRoutes(app: any): void {
  app.get("/small", (_req: any, res: any) => res.sendFile(SMALL));
  app.get("/large", (_req: any, res: any) => res.sendFile(LARGE));
}

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
    socket.setEncoding("latin1");
    socket.on("data", (d) => (out += d));
    socket.on("error", reject);
    socket.on("close", () => {
      const i = out.indexOf("\r\n\r\n");
      const head = i === -1 ? out : out.slice(0, i);
      const body = i === -1 ? "" : out.slice(i + 4);
      const [statusLine, ...headerLines] = head.split("\r\n");
      const hdrs: Record<string, string> = {};
      for (const line of headerLines) {
        const j = line.indexOf(":");
        if (j > 0) hdrs[line.slice(0, j).toLowerCase()] = line.slice(j + 1).trim();
      }
      resolve({ status: Number((statusLine ?? "").split(" ")[1]), headers: hdrs, body });
    });
  });
}

describe("byte ranges on zonix", () => {
  let app: RunningApp;
  before(async () => {
    const z: Zonix = zonix({ dev: false, etag: "weak" });
    defineRoutes(z);
    app = await start(z);
  });
  after(() => app.close());

  for (const [path, full] of [
    ["/small", SMALL_BODY],
    ["/large", LARGE_BODY.toString("latin1")],
  ] as const) {
    const size = full.length;

    test(`${path}: a plain GET advertises Accept-Ranges and sends everything`, async () => {
      const r = await raw(app.port, "GET", path);
      assert.equal(r.status, 200);
      assert.equal(r.headers["accept-ranges"], "bytes");
      assert.equal(r.headers["content-length"], String(size));
      assert.equal(r.body, full);
    });

    test(`${path}: a valid range is a 206 with Content-Range and the slice`, async () => {
      const r = await raw(app.port, "GET", path, { Range: "bytes=10-19" });
      assert.equal(r.status, 206);
      assert.equal(r.headers["content-range"], `bytes 10-19/${size}`);
      assert.equal(r.headers["content-length"], "10");
      assert.equal(r.body, full.slice(10, 20));

      const tail = await raw(app.port, "GET", path, { Range: "bytes=-7" });
      assert.equal(tail.status, 206);
      assert.equal(tail.headers["content-range"], `bytes ${size - 7}-${size - 1}/${size}`);
      assert.equal(tail.body, full.slice(size - 7));

      const open = await raw(app.port, "GET", path, { Range: `bytes=${size - 3}-` });
      assert.equal(open.status, 206);
      assert.equal(open.body, full.slice(size - 3));

      // An end past the file is clamped, as the oracle does.
      const clamped = await raw(app.port, "GET", path, { Range: `bytes=0-${size + 500}` });
      assert.equal(clamped.status, 206);
      assert.equal(clamped.headers["content-range"], `bytes 0-${size - 1}/${size}`);
    });

    test(`${path}: malformed and multipart ranges fall back to the full 200`, async () => {
      for (const range of ["bytes", "items=0-5", "bytes=0-5,20-30"]) {
        const r = await raw(app.port, "GET", path, { Range: range });
        assert.equal(r.status, 200, range);
        assert.equal(r.headers["content-range"], undefined, range);
        assert.equal(r.body, full, range);
      }
      // Adjacent and overlapping parts combine into one range -> 206.
      const combined = await raw(app.port, "GET", path, { Range: "bytes=0-4,5-9,3-6" });
      assert.equal(combined.status, 206);
      assert.equal(combined.headers["content-range"], `bytes 0-9/${size}`);
      assert.equal(combined.body, full.slice(0, 10));
    });

    test(`${path}: an unsatisfiable range is a 416 with Content-Range: bytes */size`, async () => {
      // `bytes=` and `bytes=a-b` parse (there is an `=`) but yield no
      // satisfiable range, so the oracle answers 416 for them too.
      for (const range of [`bytes=${size + 10}-${size + 20}`, "bytes=", "bytes=a-b"]) {
        const r = await raw(app.port, "GET", path, { Range: range });
        assert.equal(r.status, 416, range);
        assert.equal(r.headers["content-range"], `bytes */${size}`, range);
      }
    });

    test(`${path}: If-Range gates the 206 by ETag or by date`, async () => {
      const tag = (await raw(app.port, "GET", path)).headers["etag"] as string;
      const ok = await raw(app.port, "GET", path, { Range: "bytes=0-4", "If-Range": tag });
      assert.equal(ok.status, 206);
      const stale = await raw(app.port, "GET", path, { Range: "bytes=0-4", "If-Range": '"other"' });
      assert.equal(stale.status, 200);
      assert.equal(stale.body, full);
      const byDate = await raw(app.port, "GET", path, {
        Range: "bytes=0-4",
        "If-Range": MTIME.toUTCString(),
      });
      assert.equal(byDate.status, 206);
      const older = await raw(app.port, "GET", path, {
        Range: "bytes=0-4",
        "If-Range": "Fri, 31 Dec 1999 00:00:00 GMT",
      });
      assert.equal(older.status, 200);
    });

    test(`${path}: HEAD with a range answers 206 headers and no body`, async () => {
      const r = await raw(app.port, "HEAD", path, { Range: "bytes=0-4" });
      assert.equal(r.status, 206);
      assert.equal(r.headers["content-range"], `bytes 0-4/${size}`);
      assert.equal(r.headers["content-length"], "5");
      assert.equal(r.body, "");
    });

    test(`${path}: 304 beats 206; 412 beats both`, async () => {
      const tag = (await raw(app.port, "GET", path)).headers["etag"] as string;
      const notModified = await raw(app.port, "GET", path, {
        Range: "bytes=0-4",
        "If-None-Match": tag,
      });
      assert.equal(notModified.status, 304);
      assert.equal(notModified.headers["content-range"], undefined);
      assert.equal(notModified.body, "");

      const ifMatch = await raw(app.port, "GET", path, {
        "If-Match": '"nope"',
        Range: "bytes=0-4",
      });
      assert.equal(ifMatch.status, 412);
      const unmodified = await raw(app.port, "GET", path, {
        "If-Unmodified-Since": "Fri, 31 Dec 1999 00:00:00 GMT",
      });
      assert.equal(unmodified.status, 412);
      const okMatch = await raw(app.port, "GET", path, { "If-Match": tag.slice(2) });
      assert.equal(okMatch.status, 200);
    });
  }
});

describe("byte ranges: wire-diff against Express 4.22.2 (send@0.19.2)", () => {
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

  const PROBES: Array<[string, Record<string, string>]> = [
    ["GET", {}],
    ["GET", { Range: "bytes=10-19" }],
    ["GET", { Range: "bytes=-7" }],
    ["GET", { Range: "bytes=90-" }],
    ["GET", { Range: "bytes=0-5000" }],
    ["GET", { Range: "bytes=0-4,5-9,3-6" }],
    ["GET", { Range: "bytes=0-5,20-30" }],
    ["GET", { Range: "bytes=a-b" }],
    ["GET", { Range: "items=0-5" }],
    ["GET", { Range: "bytes" }],
    ["GET", { Range: "bytes=50000-60000" }],
    ["GET", { Range: "bytes=0-4", "If-Range": '"other"' }],
    ["GET", { Range: "bytes=0-4", "If-Range": "Fri, 31 Dec 1999 00:00:00 GMT" }],
    ["GET", { Range: "bytes=0-4", "If-Range": "Sat, 01 Jan 2000 00:00:00 GMT" }],
    ["HEAD", { Range: "bytes=0-4" }],
    ["GET", { "If-Match": '"nope"' }],
    ["GET", { "If-Unmodified-Since": "Fri, 31 Dec 1999 00:00:00 GMT" }],
    ["GET", { "If-Unmodified-Since": "Sat, 01 Jan 2000 00:00:00 GMT" }],
  ];

  for (const path of ["/small", "/large"]) {
    test(`${path}: status, Accept-Ranges, Content-Range, Content-Length and body agree`, async () => {
      const tag = (await raw(theirs.port, "GET", path)).headers["etag"] as string;
      const probes = [
        ...PROBES,
        ["GET", { Range: "bytes=0-4", "If-Range": tag }],
        ["GET", { Range: "bytes=0-4", "If-None-Match": tag }],
        ["GET", { "If-Match": tag.slice(2) }],
      ] as Array<[string, Record<string, string>]>;
      for (const [method, headers] of probes) {
        const a = await raw(mine.port, method, path, headers);
        const b = await raw(theirs.port, method, path, headers);
        const label = `${method} ${path} ${JSON.stringify(headers)}`;
        assert.equal(a.status, b.status, label);
        assert.equal(a.headers["accept-ranges"], b.headers["accept-ranges"], label);
        assert.equal(a.headers["content-range"], b.headers["content-range"], label);
        if (b.status < 400) {
          assert.equal(a.headers["content-length"], b.headers["content-length"], label);
          assert.equal(a.body, b.body, label);
        }
      }
    });
  }
});

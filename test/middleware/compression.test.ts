/**
 * `compression()` on the wire, then its decisions wire-diffed against real
 * Express 4.22.2 + the pinned `compression@1.8.1` (rule 8), plus the two
 * differentials behind it: `isCompressible` vs the `compressible` package and
 * `preferredEncoding` vs `negotiator@0.6.4`'s `encoding(available, preferred)`.
 */
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { randomBytes } from "node:crypto";
import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib";
import zonix, { compression, isCompressible, type Zonix } from "../../lib/index.js";
import { MIME_TYPE_VALUES } from "../../lib/http/mime.js";
import { preferredEncoding } from "../../lib/negotiation/index.js";
import { start, type RunningApp } from "../helpers/make-app.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const require = createRequire(import.meta.url);
const express = require("express") as any;
const compressionPkg = require("compression") as any;
const compressible = require("compressible") as (t: string) => boolean | undefined;
const Negotiator = require("compression/node_modules/negotiator") as any;

const dir = mkdtempSync(join(tmpdir(), "zonix-compress-"));
const BIG_TEXT = "The quick brown fox jumps over the lazy dog. ".repeat(200); // ~9KB, compressible
const SMALL_TEXT = "tiny";
const RANDOM = randomBytes(4096); // incompressible: gzip can only make it bigger
const LARGE_FILE = join(dir, "large.txt");
writeFileSync(LARGE_FILE, BIG_TEXT.repeat(5)); // ~45KB: streamed path
const SMALL_FILE = join(dir, "small.txt");
writeFileSync(SMALL_FILE, BIG_TEXT); // buffered path

function defineRoutes(app: any): void {
  app.get("/text", (_req: any, res: any) => res.send(BIG_TEXT));
  app.get("/json", (_req: any, res: any) => res.json({ text: BIG_TEXT }));
  app.get("/small", (_req: any, res: any) => res.send(SMALL_TEXT));
  app.get("/png", (_req: any, res: any) => {
    res.set("Content-Type", "image/png");
    res.send(Buffer.from(BIG_TEXT));
  });
  app.get("/random", (_req: any, res: any) => {
    res.set("Content-Type", "application/octet-stream");
    res.send(RANDOM);
  });
  app.get("/random-text", (_req: any, res: any) => {
    res.set("Content-Type", "text/plain");
    res.send(RANDOM);
  });
  app.get("/no-transform", (_req: any, res: any) => {
    res.set("Cache-Control", "no-transform");
    res.send(BIG_TEXT);
  });
  app.get("/file-large", (_req: any, res: any) => res.sendFile(LARGE_FILE));
  app.get("/file-small", (_req: any, res: any) => res.sendFile(SMALL_FILE));
}

function raw(
  port: number,
  method: string,
  path: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; headers: Record<string, string>; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const lines = Object.entries(headers).map(([k, v]) => `${k}: ${v}\r\n`);
    const socket = net.connect(port, "127.0.0.1", () => {
      socket.write(
        `${method} ${path} HTTP/1.1\r\nHost: t\r\nConnection: close\r\n${lines.join("")}\r\n`,
      );
    });
    const chunks: Buffer[] = [];
    socket.on("data", (d) => chunks.push(d));
    socket.on("error", reject);
    socket.on("close", () => {
      const all = Buffer.concat(chunks);
      const i = all.indexOf("\r\n\r\n");
      const head = all.subarray(0, i).toString("latin1");
      let body: Buffer = all.subarray(i + 4);
      const [statusLine, ...headerLines] = head.split("\r\n");
      const hdrs: Record<string, string> = {};
      for (const line of headerLines) {
        const j = line.indexOf(":");
        if (j > 0) hdrs[line.slice(0, j).toLowerCase()] = line.slice(j + 1).trim();
      }
      if (hdrs["transfer-encoding"] === "chunked") body = dechunk(body);
      resolve({ status: Number((statusLine ?? "").split(" ")[1]), headers: hdrs, body });
    });
  });
}

function dechunk(buf: Buffer): Buffer {
  const out: Buffer[] = [];
  let pos = 0;
  for (;;) {
    const nl = buf.indexOf("\r\n", pos);
    if (nl === -1) break;
    const size = parseInt(buf.subarray(pos, nl).toString("latin1"), 16);
    if (!size) break;
    out.push(buf.subarray(nl + 2, nl + 2 + size));
    pos = nl + 2 + size + 2;
  }
  return Buffer.concat(out);
}

function decode(encoding: string | undefined, body: Buffer): Buffer {
  if (encoding === "gzip") return gunzipSync(body);
  if (encoding === "br") return brotliDecompressSync(body);
  if (encoding === "deflate") return inflateSync(body);
  return body;
}

describe("compression(): on the wire", () => {
  let app: RunningApp;
  let off: RunningApp;
  before(async () => {
    const z: Zonix = zonix({ dev: false, etag: "weak" });
    z.use(compression());
    defineRoutes(z);
    app = await start(z);
    const o: Zonix = zonix({ dev: false });
    defineRoutes(o);
    off = await start(o);
  });
  after(async () => {
    await Promise.all([app.close(), off.close()]);
  });

  test("without the middleware nothing changes: no Vary, no Content-Encoding", async () => {
    const r = await raw(off.port, "GET", "/text", { "Accept-Encoding": "gzip, br" });
    assert.equal(r.headers["content-encoding"], undefined);
    assert.equal(r.headers["vary"], undefined);
    assert.equal(r.body.toString(), BIG_TEXT);
  });

  test("Accept-Encoding permutations choose the right encoding; bodies round-trip", async () => {
    const cases: Array<[string | undefined, string | undefined]> = [
      ["gzip", "gzip"],
      ["br", "br"],
      ["deflate", "deflate"],
      ["gzip, deflate, br", "br"], // preferred order at equal q
      ["gzip, deflate", "gzip"],
      ["deflate, gzip", "gzip"], // preferred over header order at equal q
      ["gzip;q=0.5, br;q=0.9", "br"],
      ["gzip;q=0.9, br;q=0.5", "gzip"],
      ["br;q=0, gzip", "gzip"],
      ["identity", undefined],
      ["*", "br"],
      ["identity;q=0, gzip", "gzip"],
      ["bogus", undefined],
      [undefined, undefined],
    ];
    for (const [accept, expected] of cases) {
      const headers: Record<string, string> =
        accept === undefined ? {} : { "Accept-Encoding": accept };
      for (const path of ["/text", "/json"]) {
        const r = await raw(app.port, "GET", path, headers);
        assert.equal(r.status, 200, `${path} ${accept}`);
        assert.equal(r.headers["content-encoding"], expected, `${path} ${accept}`);
        assert.equal(r.headers["vary"], "Accept-Encoding", `${path} ${accept} vary`);
        assert.equal(
          r.headers["content-length"],
          String(r.body.byteLength),
          `${path} ${accept} length`,
        );
        const plain = decode(expected, r.body).toString();
        assert.equal(plain, path === "/text" ? BIG_TEXT : JSON.stringify({ text: BIG_TEXT }));
        if (expected !== undefined)
          assert.ok(r.body.byteLength < plain.length, "smaller than identity");
      }
    }
  });

  test("below the threshold: identity, Vary still set", async () => {
    const r = await raw(app.port, "GET", "/small", { "Accept-Encoding": "gzip" });
    assert.equal(r.headers["content-encoding"], undefined);
    assert.equal(r.headers["vary"], "Accept-Encoding");
    assert.equal(r.body.toString(), SMALL_TEXT);
  });

  test("non-compressible type: untouched, no Vary; no-transform: untouched", async () => {
    const png = await raw(app.port, "GET", "/png", { "Accept-Encoding": "gzip" });
    assert.equal(png.headers["content-encoding"], undefined);
    assert.equal(png.headers["vary"], undefined);
    const nt = await raw(app.port, "GET", "/no-transform", { "Accept-Encoding": "gzip" });
    assert.equal(nt.headers["content-encoding"], undefined);
    assert.equal(nt.body.toString(), BIG_TEXT);
  });

  test("no benefit: a text body that does not shrink goes out as identity", async () => {
    const r = await raw(app.port, "GET", "/random-text", { "Accept-Encoding": "gzip" });
    assert.equal(r.status, 200);
    assert.equal(r.headers["content-encoding"], undefined);
    assert.equal(r.headers["content-length"], String(RANDOM.length));
    assert.ok(r.body.equals(RANDOM));
  });

  test("HEAD: headers negotiate (Vary), nothing is compressed, no body", async () => {
    const r = await raw(app.port, "HEAD", "/text", { "Accept-Encoding": "gzip" });
    assert.equal(r.status, 200);
    assert.equal(r.headers["vary"], "Accept-Encoding");
    assert.equal(r.headers["content-encoding"], undefined);
    assert.equal(r.body.byteLength, 0);
  });

  test("ETag is computed on the uncompressed body and still drives 304", async () => {
    const first = await raw(app.port, "GET", "/text", { "Accept-Encoding": "gzip" });
    const plain = await raw(off.port, "GET", "/text");
    assert.ok(first.headers["etag"]);
    const again = await raw(app.port, "GET", "/text", {
      "Accept-Encoding": "gzip",
      "If-None-Match": first.headers["etag"] as string,
    });
    assert.equal(again.status, 304);
    assert.equal(again.headers["content-encoding"], undefined);
    assert.equal(again.body.byteLength, 0);
    // The same tag a non-compressing app would produce (the weak tag of the raw body).
    const offTagged = zonix({ dev: false, etag: "weak" });
    defineRoutes(offTagged);
    const r2 = await start(offTagged);
    try {
      assert.equal((await raw(r2.port, "GET", "/text")).headers["etag"], first.headers["etag"]);
    } finally {
      await r2.close();
    }
    assert.equal(plain.status, 200);
  });

  test("sendFile: buffered file compressed with Content-Length; streamed file compressed chunked", async () => {
    const small = await raw(app.port, "GET", "/file-small", { "Accept-Encoding": "gzip" });
    assert.equal(small.headers["content-encoding"], "gzip");
    assert.equal(small.headers["content-length"], String(small.body.byteLength));
    assert.equal(gunzipSync(small.body).toString(), BIG_TEXT);

    const large = await raw(app.port, "GET", "/file-large", { "Accept-Encoding": "br" });
    assert.equal(large.headers["content-encoding"], "br");
    assert.equal(large.headers["content-length"], undefined);
    assert.equal(large.headers["transfer-encoding"], "chunked");
    assert.equal(brotliDecompressSync(large.body).toString(), BIG_TEXT.repeat(5));

    // A byte range is never compressed.
    const part = await raw(app.port, "GET", "/file-large", {
      "Accept-Encoding": "gzip",
      Range: "bytes=0-9",
    });
    assert.equal(part.status, 206);
    assert.equal(part.headers["content-encoding"], undefined);
    assert.equal(part.body.toString(), BIG_TEXT.slice(0, 10));
  });

  test("threshold and br options", async () => {
    const z = zonix({ dev: false });
    z.use(compression({ threshold: 0, br: false }));
    defineRoutes(z);
    const r = await start(z);
    try {
      const small = await raw(r.port, "GET", "/small", { "Accept-Encoding": "gzip" });
      assert.equal(
        small.headers["content-encoding"],
        undefined,
        "4 bytes never shrink: no benefit",
      );
      const noBr = await raw(r.port, "GET", "/text", { "Accept-Encoding": "br, gzip" });
      assert.equal(noBr.headers["content-encoding"], "gzip");
    } finally {
      await r.close();
    }
  });
});

describe("compression(): wire-diff against Express + compression@1.8.1", () => {
  let mine: RunningApp;
  let theirs: { port: number; close: () => Promise<void> };
  before(async () => {
    const z: Zonix = zonix({ dev: false, etag: "weak" });
    z.use(compression());
    defineRoutes(z);
    mine = await start(z);
    const ex = express();
    ex.use(compressionPkg());
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

  test("Content-Encoding, Vary, status and decoded body agree across accept headers and routes", async () => {
    const ACCEPTS = [
      undefined,
      "gzip",
      "br",
      "deflate",
      "gzip, deflate, br",
      "deflate, gzip",
      "gzip;q=0.5, br;q=0.9",
      "br;q=0, gzip",
      "identity",
      "*",
      "bogus",
    ];
    const PATHS = [
      "/text",
      "/json",
      "/small",
      "/png",
      "/no-transform",
      "/file-small",
      "/file-large",
    ];
    for (const accept of ACCEPTS) {
      for (const path of PATHS) {
        const headers: Record<string, string> =
          accept === undefined ? {} : { "Accept-Encoding": accept };
        const a = await raw(mine.port, "GET", path, headers);
        const b = await raw(theirs.port, "GET", path, headers);
        const label = `${path} ${accept}`;
        assert.equal(a.status, b.status, label);
        assert.equal(a.headers["content-encoding"], b.headers["content-encoding"], label);
        assert.equal(a.headers["vary"], b.headers["vary"], label);
        assert.ok(
          decode(a.headers["content-encoding"], a.body).equals(
            decode(b.headers["content-encoding"], b.body),
          ),
          `${label} body`,
        );
      }
    }
  });

  test("HEAD agrees", async () => {
    const a = await raw(mine.port, "HEAD", "/text", { "Accept-Encoding": "gzip" });
    const b = await raw(theirs.port, "HEAD", "/text", { "Accept-Encoding": "gzip" });
    assert.equal(a.status, b.status);
    assert.equal(a.headers["content-encoding"], b.headers["content-encoding"]);
    assert.equal(a.headers["vary"], b.headers["vary"]);
  });
});

describe("compression(): the two differentials behind it", () => {
  test("isCompressible agrees with the compressible package on the whole MIME map and more", () => {
    const extra = [
      "text/html",
      "text/plain; charset=utf-8",
      "application/json",
      "application/vnd.api+json",
      "application/ld+json",
      "application/javascript",
      "application/xml",
      "application/atom+xml",
      "image/svg+xml",
      "image/png",
      "image/jpeg",
      "image/webp",
      "application/octet-stream",
      "application/pdf",
      "application/zip",
      "application/gzip",
      "video/mp4",
      "audio/mpeg",
      "font/woff2",
      "font/ttf",
      "application/wasm",
      "application/x-www-form-urlencoded",
      "multipart/form-data; boundary=x",
      "application/rtf",
      "image/x-icon",
      "image/bmp",
    ];
    for (const type of [...MIME_TYPE_VALUES, ...extra]) {
      assert.equal(isCompressible(type), compressible(type) === true, type);
    }
  });

  test("preferredEncoding agrees with negotiator@0.6.4 encoding(available, preferred)", () => {
    const SUPPORTED = ["br", "gzip", "deflate", "identity"];
    const PREFERRED = ["br", "gzip"];
    const ACCEPTS = [
      undefined,
      "",
      "gzip",
      "br",
      "deflate",
      "identity",
      "*",
      "gzip, deflate, br",
      "deflate, gzip",
      "br, gzip",
      "gzip;q=0.5, br;q=0.9",
      "gzip;q=0.9, br;q=0.5",
      "br;q=0, gzip",
      "identity;q=0, gzip",
      "identity;q=0",
      "gzip;q=0, deflate;q=0, br;q=0",
      "*;q=0",
      "*;q=0.1, gzip;q=0.1",
      "bogus",
      "gzip;q=abc",
      " gzip , br ",
      "GZIP",
      "deflate;q=1, gzip;q=1, br;q=1",
    ];
    for (const accept of ACCEPTS) {
      for (const [supported, preferred] of [
        [SUPPORTED, PREFERRED],
        [["gzip", "deflate", "identity"], ["gzip"]],
        [SUPPORTED, undefined],
      ] as Array<[string[], string[] | undefined]>) {
        const n = new Negotiator({
          headers: accept === undefined ? {} : { "accept-encoding": accept },
        });
        assert.equal(
          preferredEncoding(accept, supported, preferred),
          n.encoding(supported, preferred),
          `${JSON.stringify(accept)} ${JSON.stringify(preferred)}`,
        );
      }
    }
  });
});

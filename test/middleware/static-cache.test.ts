/**
 * `serveStatic({ cache: { maxBytes } })`: LRU by bytes, one stat per hit with
 * mtime/size revalidation, 304/206/compression on top of the cached bytes,
 * disconnect mid-send, cap boundaries - and the rule-3 equivalence: cached
 * and uncached are wire-identical for every probe in the range/conditional/
 * compression corpus, on the first (miss) and second (hit) request alike.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, statSync, utimesSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib";
import zonix, { compression, serveStatic, type Zonix, type ZonixError } from "../../lib/index.js";
import { FileCache } from "../../lib/internal/file-cache.js";
import { start, type RunningApp } from "../helpers/make-app.js";
import { trapUnhandledRejections } from "../helpers/tripwire.js";

const root = mkdtempSync(join(tmpdir(), "zonix-static-cache-"));
const MTIME = new Date("2000-01-01T00:00:00Z");
const LATER = new Date("2001-01-01T00:00:00Z");

function put(name: string, body: string | Buffer, mtime: Date = MTIME): string {
  const file = join(root, name);
  writeFileSync(file, body);
  utimesSync(file, mtime, mtime);
  return file;
}

const KB = 1000;
put("a.txt", "a".repeat(KB));
put("b.txt", "b".repeat(KB));
put("c.txt", "c".repeat(KB));
const SMALL_BODY = Array.from({ length: 100 }, (_, i) => String(i % 10)).join("");
put("small.txt", SMALL_BODY);
const LARGE_BODY = Buffer.alloc(40_000, "z"); // > 32KB: the uncached path streams this
put("large.txt", LARGE_BODY);
const TEXT_BODY = "<p>" + "compressible text ".repeat(200) + "</p>";
put("text.html", TEXT_BODY);
put("noise.bin", randomBytes(4096));
mkdirSync(join(root, "dir"));
put("dir/index.html", "<h1>dir index</h1>");
const HUGE = 8 * 1024 * 1024;
put("huge.bin", Buffer.alloc(HUGE, 7));

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
    socket.on("data", (d: Buffer) => chunks.push(d));
    socket.on("error", reject);
    socket.on("close", () => {
      const all = Buffer.concat(chunks);
      const i = all.indexOf("\r\n\r\n");
      const head = (i === -1 ? all : all.subarray(0, i)).toString("latin1");
      const body: Buffer = i === -1 ? Buffer.alloc(0) : all.subarray(i + 4);
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

/** Record every error the app sees; answer with its suggested status, as the default responder would. */
function recordErrors(app: Zonix): ZonixError[] {
  const seen: ZonixError[] = [];
  app.handleErr((err, _req, res) => {
    seen.push(err);
    if (err.clientDisconnect || res.headersSent) return;
    res.status(err.status ?? 500).end();
  });
  return seen;
}

function decode(encoding: string | undefined, body: Buffer): Buffer {
  if (encoding === "gzip") return gunzipSync(body);
  if (encoding === "deflate") return inflateSync(body);
  if (encoding === "br") return brotliDecompressSync(body);
  return body;
}

describe("FileCache: LRU by bytes", () => {
  const entry = (n: number, fill = "x") => {
    const body = Buffer.alloc(n, fill);
    return { body, stats: statSync(join(root, "a.txt")), tag: '"t"' };
  };

  test("hit, miss, and accounting", () => {
    const cache = new FileCache(2500);
    assert.equal(cache.get("a"), undefined);
    assert.equal(cache.set("a", entry(KB)), true);
    assert.equal(cache.bytes, KB);
    assert.equal(cache.size, 1);
    assert.equal(cache.get("a")?.body.byteLength, KB);
    assert.equal(cache.delete("a"), true);
    assert.equal(cache.bytes, 0);
    assert.equal(cache.delete("a"), false);
  });

  test("evicts least recently used until the new entry fits", () => {
    const cache = new FileCache(2500);
    cache.set("a", entry(KB));
    cache.set("b", entry(KB));
    cache.set("c", entry(KB)); // 3000 > 2500: a goes
    assert.equal(cache.get("a"), undefined);
    assert.ok(cache.get("b"));
    assert.ok(cache.get("c"));
    assert.equal(cache.bytes, 2 * KB);

    // A get refreshes recency: b was just touched, so c is the victim now...
    cache.get("b");
    cache.set("d", entry(KB));
    assert.equal(cache.get("c"), undefined);
    assert.ok(cache.get("b"));
    assert.ok(cache.get("d"));
  });

  test("cap boundaries: exactly the cap fits, one byte over does not, a replace re-accounts", () => {
    const cache = new FileCache(2000);
    assert.equal(cache.set("big", entry(2000)), true);
    assert.equal(cache.bytes, 2000);
    assert.equal(cache.set("bigger", entry(2001)), false);
    assert.equal(cache.get("bigger"), undefined);
    assert.ok(cache.get("big")); // a refused entry evicts nothing

    cache.set("a", entry(KB)); // evicts big (2000 + 1000 > 2000)
    assert.equal(cache.get("big"), undefined);
    assert.equal(cache.bytes, KB);
    cache.set("a", entry(500)); // replacing re-accounts, not double-counts
    assert.equal(cache.bytes, 500);
    assert.equal(cache.size, 1);
    cache.clear();
    assert.equal(cache.bytes, 0);
  });

  test("a refused oversize entry also drops the stale one under that key", () => {
    const cache = new FileCache(1500);
    cache.set("a", entry(KB));
    assert.equal(cache.set("a", entry(1501)), false);
    assert.equal(cache.get("a"), undefined);
    assert.equal(cache.bytes, 0);
  });

  test("isCurrent compares mtime and size", () => {
    const stats = statSync(join(root, "a.txt"));
    const e = { body: Buffer.alloc(KB), stats, tag: '"t"' };
    assert.equal(FileCache.isCurrent(e, stats), true);
    assert.equal(
      FileCache.isCurrent(e, { ...stats, mtimeMs: stats.mtimeMs + 1 } as typeof stats),
      false,
    );
    assert.equal(FileCache.isCurrent(e, { ...stats, size: stats.size + 1 } as typeof stats), false);
  });
});

describe("serveStatic({ cache }) on the wire", () => {
  const trap = trapUnhandledRejections();
  let app: RunningApp;
  let errors: ZonixError[];
  before(async () => {
    const z: Zonix = zonix({ dev: false, etag: "weak" });
    errors = recordErrors(z);
    z.use(compression());
    z.use(serveStatic(root, { cache: { maxBytes: 2500 } }));
    app = await start(z);
  });
  after(async () => {
    await app.close();
    trap.restore();
    assert.deepEqual(trap.reasons, []);
  });

  test("hit: a same-mtime same-size rewrite is served from memory; an mtime change is reread byte-exact", async () => {
    const first = await raw(app.port, "GET", "/a.txt");
    assert.equal(first.status, 200);
    assert.equal(first.body.toString(), "a".repeat(KB));

    // Same size, same mtime: the cache cannot tell and must not stat-miss.
    put("a.txt", "A".repeat(KB), MTIME);
    const hit = await raw(app.port, "GET", "/a.txt");
    assert.equal(hit.body.toString(), "a".repeat(KB), "served from the cache, not disk");

    // mtime changes: evict + reread, byte-exact, validators follow the file.
    put("a.txt", "B".repeat(KB), LATER);
    const reread = await raw(app.port, "GET", "/a.txt");
    assert.equal(reread.body.toString(), "B".repeat(KB));
    assert.equal(reread.headers["last-modified"], LATER.toUTCString());
    assert.equal(reread.headers["content-length"], String(KB));

    // Size change with the same mtime is a change too.
    put("a.txt", "C".repeat(KB - 1), LATER);
    const resized = await raw(app.port, "GET", "/a.txt");
    assert.equal(resized.body.toString(), "C".repeat(KB - 1));
    put("a.txt", "a".repeat(KB), MTIME);
  });

  test("evict at the byte cap: the LRU file is reread, the touched one stays cached", async () => {
    // Cap 2500 holds two 1000-byte files. a (fresh from above), b, then c evicts a.
    await raw(app.port, "GET", "/a.txt");
    await raw(app.port, "GET", "/b.txt");
    await raw(app.port, "GET", "/a.txt"); // touch a: b becomes LRU
    await raw(app.port, "GET", "/c.txt"); // evicts b

    put("b.txt", "B".repeat(KB), MTIME); // invisible change: proves miss vs hit
    put("a.txt", "A".repeat(KB), MTIME);
    const a = await raw(app.port, "GET", "/a.txt");
    assert.equal(a.body.toString(), "a".repeat(KB), "a was touched, so it stayed cached");
    const b = await raw(app.port, "GET", "/b.txt");
    assert.equal(b.body.toString(), "B".repeat(KB), "b was evicted, so it is reread");
    // Rereading b (1000 bytes into a full 2500 cap) evicts the LRU, now c.
    put("c.txt", "C".repeat(KB), MTIME);
    const c = await raw(app.port, "GET", "/c.txt");
    assert.equal(c.body.toString(), "C".repeat(KB), "c was the LRU when b came back");
    put("c.txt", "c".repeat(KB), MTIME);
    put("a.txt", "a".repeat(KB), MTIME);
    put("b.txt", "b".repeat(KB), MTIME);
  });

  test("a file over the cap is served but never cached", async () => {
    const first = await raw(app.port, "GET", "/large.txt");
    assert.equal(first.status, 200);
    assert.equal(first.body.byteLength, 40_000);
    put("large.txt", Buffer.alloc(40_000, "y"), MTIME); // invisible change
    const second = await raw(app.port, "GET", "/large.txt");
    assert.equal(second.body[0], "y".charCodeAt(0), "not cached: the rewrite shows");
    put("large.txt", LARGE_BODY, MTIME);
  });

  test("304 from the cache, by tag and by date", async () => {
    const full = await raw(app.port, "GET", "/small.txt");
    const tag = full.headers["etag"] as string;
    assert.match(tag, /^W\/"/);
    const byTag = await raw(app.port, "GET", "/small.txt", { "If-None-Match": tag });
    assert.equal(byTag.status, 304);
    assert.equal(byTag.body.byteLength, 0);
    assert.equal(byTag.headers["etag"], tag);
    assert.equal(byTag.headers["content-length"], undefined);
    const byDate = await raw(app.port, "GET", "/small.txt", {
      "If-Modified-Since": MTIME.toUTCString(),
    });
    assert.equal(byDate.status, 304);
    const stale = await raw(app.port, "GET", "/small.txt", { "If-None-Match": 'W/"nope"' });
    assert.equal(stale.status, 200);
    assert.equal(stale.body.toString(), SMALL_BODY);
  });

  test("206 slice from the cache; 304 still beats it; 416 still fires", async () => {
    const r = await raw(app.port, "GET", "/small.txt", { Range: "bytes=10-19" });
    assert.equal(r.status, 206);
    assert.equal(r.headers["content-range"], "bytes 10-19/100");
    assert.equal(r.headers["content-length"], "10");
    assert.equal(r.body.toString(), SMALL_BODY.slice(10, 20));
    const tail = await raw(app.port, "GET", "/small.txt", { Range: "bytes=-7" });
    assert.equal(tail.body.toString(), SMALL_BODY.slice(93));
    const tag = r.headers["etag"] as string;
    const nm = await raw(app.port, "GET", "/small.txt", {
      Range: "bytes=0-4",
      "If-None-Match": tag,
    });
    assert.equal(nm.status, 304);
    const bad = await raw(app.port, "GET", "/small.txt", { Range: "bytes=500-600" });
    assert.equal(bad.status, 416);
    assert.equal(bad.headers["content-range"], "bytes */100");
  });

  test("compression on top of cached bytes; ETag is the raw tag; random bytes stay identity", async () => {
    const plain = await raw(app.port, "GET", "/text.html");
    const tag = plain.headers["etag"];
    for (const enc of ["gzip", "br", "deflate"]) {
      const r = await raw(app.port, "GET", "/text.html", { "Accept-Encoding": enc });
      assert.equal(r.status, 200);
      assert.equal(r.headers["content-encoding"], enc);
      assert.equal(r.headers["vary"], "Accept-Encoding");
      assert.equal(r.headers["etag"], tag, "tag computed on the raw body");
      assert.ok(Number(r.headers["content-length"]) < TEXT_BODY.length);
      assert.equal(decode(enc, r.body).toString(), TEXT_BODY);
    }
    // 304 with an encoding requested: still from the raw tag.
    const nm = await raw(app.port, "GET", "/text.html", {
      "Accept-Encoding": "gzip",
      "If-None-Match": tag as string,
    });
    assert.equal(nm.status, 304);
    // A 206 is never compressed.
    const part = await raw(app.port, "GET", "/text.html", {
      "Accept-Encoding": "gzip",
      Range: "bytes=0-9",
    });
    assert.equal(part.status, 206);
    assert.equal(part.headers["content-encoding"], undefined);
    assert.equal(part.body.toString(), TEXT_BODY.slice(0, 10));
    // No benefit -> identity.
    const noise = await raw(app.port, "GET", "/noise.bin", { "Accept-Encoding": "gzip" });
    assert.equal(noise.headers["content-encoding"], undefined);
    assert.equal(noise.body.byteLength, 4096);
  });

  test("HEAD from the cache: headers, no body", async () => {
    await raw(app.port, "GET", "/small.txt");
    const r = await raw(app.port, "HEAD", "/small.txt");
    assert.equal(r.status, 200);
    assert.equal(r.headers["content-length"], "100");
    assert.equal(r.body.byteLength, 0);
  });

  test("directory index is cached under the index file", async () => {
    const r = await raw(app.port, "GET", "/dir/");
    assert.equal(r.status, 200);
    assert.equal(r.body.toString(), "<h1>dir index</h1>");
    put("dir/index.html", "<h1>changed</h1>", MTIME); // same size? no - 16 vs 18 bytes: a size change
    const again = await raw(app.port, "GET", "/dir/");
    assert.equal(again.body.toString(), "<h1>changed</h1>");
    put("dir/index.html", "<h1>dir index</h1>", MTIME);
  });

  test("a miss falls through to the 404 without touching the error path", async () => {
    errors.length = 0;
    const r = await raw(app.port, "GET", "/missing.txt");
    assert.equal(r.status, 404);
    assert.equal(errors.length, 0);
    const dir = await raw(app.port, "GET", "/nope/");
    assert.equal(dir.status, 404);
    assert.equal(errors.length, 0);
  });
});

describe("serveStatic({ cache }): disconnect mid-cached-send", () => {
  const trap = trapUnhandledRejections();
  let app: RunningApp;
  let errors: ZonixError[];
  before(async () => {
    const z: Zonix = zonix({ dev: false });
    errors = recordErrors(z);
    z.use(serveStatic(root, { cache: { maxBytes: 16 * 1024 * 1024 } }));
    app = await start(z);
  });
  after(async () => {
    await app.close();
    trap.restore();
    assert.deepEqual(trap.reasons, []);
  });

  test("the client drops the socket after the headers; the server survives and serves the next request", async () => {
    // Warm the cache so the send really is from memory.
    const warm = await raw(app.port, "GET", "/huge.bin");
    assert.equal(warm.body.byteLength, HUGE);

    await new Promise<void>((resolve, reject) => {
      const socket = net.connect(app.port, "127.0.0.1", () => {
        socket.write("GET /huge.bin HTTP/1.1\r\nHost: t\r\n\r\n");
      });
      let seen = 0;
      socket.on("data", (d: Buffer) => {
        seen += d.byteLength;
        if (seen > 64 * 1024) socket.destroy();
      });
      socket.on("error", reject);
      socket.on("close", () => resolve());
    });
    await new Promise((r) => setTimeout(r, 50));
    for (const err of errors) assert.equal(err.clientDisconnect, true, `untagged: ${err.message}`);

    const next = await raw(app.port, "GET", "/small.txt");
    assert.equal(next.status, 200);
    assert.equal(next.body.toString(), SMALL_BODY);
  });
});

describe("serveStatic({ cache }) equivalence: cached vs uncached, wire-identical", () => {
  let cached: RunningApp;
  let plain: RunningApp;
  before(async () => {
    const mk = (cache: boolean) => {
      const z: Zonix = zonix({ dev: false, etag: "weak" });
      z.use(compression());
      z.use(serveStatic(root, cache ? { cache: { maxBytes: 1024 * 1024 } } : {}));
      return start(z);
    };
    [cached, plain] = await Promise.all([mk(true), mk(false)]);
  });
  after(async () => {
    await Promise.all([cached.close(), plain.close()]);
  });

  const PROBES: Array<[string, Record<string, string>]> = [
    ["GET", {}],
    ["HEAD", {}],
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
    ["GET", { "If-Modified-Since": "Sat, 01 Jan 2000 00:00:00 GMT" }],
    ["GET", { "If-Modified-Since": "Fri, 31 Dec 1999 00:00:00 GMT" }],
    ["GET", { "If-None-Match": "*" }],
    ["GET", { "Accept-Encoding": "gzip" }],
    ["GET", { "Accept-Encoding": "br" }],
    ["GET", { "Accept-Encoding": "deflate" }],
    ["GET", { "Accept-Encoding": "gzip, br" }],
    ["GET", { "Accept-Encoding": "identity" }],
    ["GET", { "Accept-Encoding": "*;q=0" }],
    ["HEAD", { "Accept-Encoding": "gzip" }],
    ["GET", { "Accept-Encoding": "gzip", Range: "bytes=0-9" }],
    ["GET", { "Accept-Encoding": "gzip", "Cache-Control": "no-transform" }],
  ];
  // Transport framing may legitimately differ for a large compressed body: the
  // uncached path streams it chunked, the cached path knows the length. Every
  // other header and the decoded body must agree.
  const FRAMING = new Set(["content-length", "transfer-encoding"]);

  for (const path of ["/small.txt", "/large.txt", "/text.html", "/noise.bin", "/dir/"]) {
    test(`${path}: every probe agrees on miss and on hit`, async () => {
      const tag = (await raw(plain.port, "GET", path)).headers["etag"] as string;
      const probes = [
        ...PROBES,
        ["GET", { Range: "bytes=0-4", "If-Range": tag }],
        ["GET", { Range: "bytes=0-4", "If-None-Match": tag }],
        ["GET", { "If-None-Match": tag }],
        ["GET", { "If-None-Match": tag, "Accept-Encoding": "gzip" }],
        ["GET", { "If-Match": tag.slice(2) }],
      ] as Array<[string, Record<string, string>]>;
      for (const [method, headers] of probes) {
        const b = await raw(plain.port, method, path, headers);
        for (const pass of ["miss", "hit"]) {
          const a = await raw(cached.port, method, path, headers);
          const label = `${pass} ${method} ${path} ${JSON.stringify(headers)}`;
          assert.equal(a.status, b.status, label);
          const encoded = b.headers["content-encoding"] !== undefined && b.status === 200;
          const streamedEncoded = encoded && b.headers["transfer-encoding"] === "chunked";
          const keys = new Set([...Object.keys(a.headers), ...Object.keys(b.headers)]);
          for (const key of keys) {
            if (key === "date") continue;
            if (streamedEncoded && FRAMING.has(key)) continue;
            assert.equal(a.headers[key], b.headers[key], `${label} header ${key}`);
          }
          if (b.status < 400) {
            const bodyA = streamedEncoded ? decode(a.headers["content-encoding"], a.body) : a.body;
            const bodyB = streamedEncoded
              ? decode(b.headers["content-encoding"], dechunk(b.body))
              : b.body;
            assert.ok(bodyA.equals(bodyB), `${label} body`);
          }
        }
      }
    });
  }
});

/** Join a chunked transfer-encoded body. */
function dechunk(body: Buffer): Buffer {
  const out: Buffer[] = [];
  let i = 0;
  for (;;) {
    const nl = body.indexOf("\r\n", i);
    if (nl === -1) break;
    const size = parseInt(body.subarray(i, nl).toString("latin1"), 16);
    if (!Number.isFinite(size) || size === 0) break;
    out.push(body.subarray(nl + 2, nl + 2 + size));
    i = nl + 2 + size + 2;
  }
  return Buffer.concat(out);
}

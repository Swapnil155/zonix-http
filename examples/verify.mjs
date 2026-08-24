// Runs every example against a live local zonix-http server and asserts the
// documented behavior. `node verify.mjs` — exits non-zero on any failure.
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { io as ioClient } from "socket.io-client";

const results = [];
const ok = (name) => results.push(`  PASS  ${name}`);

const listen = (server) =>
  new Promise((res) => server.listen(0, "127.0.0.1", () => res(server.address().port)));

// Force-close so a half-sent (rejected) upload connection can't hang close().
const stop = (server) =>
  new Promise((res) => {
    server.closeAllConnections?.();
    server.close(() => res());
  });

// ---- (a) uploads -----------------------------------------------------------
{
  const { makeApp } = await import("./uploads.mjs");
  const { app, cleanup } = await makeApp();
  const port = await listen(app.server);

  // A valid small upload is accepted.
  const boundary = "----zxtest";
  const body = (filename, bytes) =>
    Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="f"; filename="${filename}"\r\n` +
          `Content-Type: application/octet-stream\r\n\r\n`,
      ),
      bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
  const post = (buf) =>
    fetch(`http://127.0.0.1:${port}/upload`, {
      method: "POST",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      body: buf,
    });

  let r = await post(body("hello.txt", Buffer.from("hi there")));
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).uploaded, ["hello.txt"]);
  ok("uploads: a small file is accepted and saved under its basename");

  // A traversal filename is stripped to its basename (not rejected here since
  // basename("../../etc/passwd") === "passwd") — prove no escape.
  r = await post(body("../../secret.txt", Buffer.from("x")));
  const names = (await r.json()).uploaded;
  assert.deepEqual(names, ["secret.txt"], "filename must be reduced to its basename");
  ok("uploads: a traversal filename is reduced to its basename");

  // Over the 5 MB fileSize cap → 413.
  r = await post(body("big.bin", Buffer.alloc(6 * 1024 * 1024, 1)));
  assert.equal(r.status, 413, "oversize upload must be 413");
  ok("uploads: a file past the 5 MB cap is rejected with 413");

  await stop(app.server);
  await cleanup();
}

// ---- (b) realtime (socket.io + WebRTC signaling relay) ---------------------
{
  const { makeServer } = await import("./realtime.mjs");
  const { app } = makeServer();
  const port = await listen(app.server);
  const url = `http://127.0.0.1:${port}`;

  const a = ioClient(url, { transports: ["websocket"] });
  const b = ioClient(url, { transports: ["websocket"] });
  await Promise.all([
    new Promise((res) => a.on("connect", res)),
    new Promise((res) => b.on("connect", res)),
  ]);
  ok("realtime: two socket.io clients connect to app.server");

  // WebRTC signaling: B joins the room, A sends an offer, B receives it relayed.
  const relayed = new Promise((res) => b.on("offer", (m) => res(m)));
  b.emit("join", "room1");
  await new Promise((res) => setTimeout(res, 50));
  a.emit("join", "room1");
  await new Promise((res) => setTimeout(res, 50));
  a.emit("offer", { room: "room1", sdp: "v=0-fake-offer" });
  const msg = await relayed;
  assert.equal(msg.sdp, "v=0-fake-offer", "offer SDP must relay peer-to-peer");
  ok("realtime: an SDP offer is relayed between peers");

  a.close();
  b.close();
  await stop(app.server);
}

// ---- (c) HTTPS / TLS -------------------------------------------------------
{
  const { makeProxyApp, makeHttpsServer } = await import("./https-tls.mjs");

  // Reverse-proxy path: X-Forwarded-Proto is honored under trustProxy.
  const app = makeProxyApp();
  const pport = await listen(app.server);
  let r = await fetch(`http://127.0.0.1:${pport}/whoami`, {
    headers: { "x-forwarded-proto": "https" },
  });
  let j = await r.json();
  assert.equal(j.protocol, "https", "trustProxy must honor X-Forwarded-Proto");
  assert.equal(j.secure, true);
  ok("https: reverse-proxy path — X-Forwarded-Proto makes req.secure true");
  await stop(app.server);

  // Direct in-process TLS with a generated self-signed cert.
  const dir = join(tmpdir(), `zx-tls-${process.pid}`);
  execFileSync("node", ["-e", `require('fs').mkdirSync(${JSON.stringify(dir)},{recursive:true})`]);
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      join(dir, "key.pem"),
      "-out",
      join(dir, "cert.pem"),
      "-days",
      "2",
      "-subj",
      "/CN=localhost",
    ],
    { stdio: "ignore", env: { ...process.env, MSYS_NO_PATHCONV: "1" } },
  );
  const server = makeHttpsServer(
    readFileSync(join(dir, "key.pem")),
    readFileSync(join(dir, "cert.pem")),
  );
  const sport = await listen(server);
  const prev = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  r = await fetch(`https://127.0.0.1:${sport}/whoami`);
  j = await r.json();
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = prev ?? "1";
  assert.equal(r.status, 200);
  assert.equal(j.secure, true, "direct TLS: req.secure must be true on an encrypted socket");
  ok("https: direct node:https path serves and req.secure is true");
  await stop(server);
}

// ---- (d) compressed request bodies -----------------------------------------
{
  const { makeApp } = await import("./compressed-body.mjs");
  const app = makeApp(1 * 1024 * 1024); // 1 MB decompressed cap for the test
  const port = await listen(app.server);
  const url = `http://127.0.0.1:${port}/ingest`;

  // A normal gzipped body inflates and the handler sees the plaintext length.
  const plain = Buffer.from(JSON.stringify({ hello: "world", n: 123 }));
  let r = await fetch(url, {
    method: "POST",
    headers: { "content-encoding": "gzip", "content-type": "application/json" },
    body: gzipSync(plain),
  });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).bytes, plain.length, "inflated byte count must match plaintext");
  ok("compressed-body: a gzip body inflates to the correct plaintext length");

  // A gzip "bomb": ~2 MB of zeros compresses tiny but exceeds the 1 MB cap → 413.
  const bomb = gzipSync(Buffer.alloc(2 * 1024 * 1024, 0));
  assert.ok(bomb.length < 50 * 1024, "bomb should be small on the wire");
  r = await fetch(url, {
    method: "POST",
    headers: { "content-encoding": "gzip", "content-type": "application/json" },
    body: bomb,
  });
  assert.equal(r.status, 413, "a body past the decompressed cap must be 413");
  ok("compressed-body: the decompressed-byte cap trips a decompression bomb (413)");

  await stop(app.server);
}

console.log("\n" + results.join("\n"));
console.log(`\nAll ${results.length} example checks passed.\n`);

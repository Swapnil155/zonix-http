// ZH-002 · CWE-444 · HTTP request smuggling / framing ambiguity.
//
// zonix relies on Node's canonical HTTP parser (insecureHTTPParser is never
// enabled) and its body reader counts the bytes Node actually delivers — it
// never re-derives message length from Content-Length. This suite proves that
// ambiguous framing (CL+TE, conflicting CLs) does not desync: the client gets
// exactly one well-formed response (or a clean rejection), never a second
// smuggled request's response.
import assert from "node:assert/strict";
import net from "node:net";
import { after, before, describe, test } from "node:test";
import { makeApp } from "../helpers/make-app.js";
import type { RunningApp } from "../helpers/make-app.js";
import { start } from "../helpers/make-app.js";
import "../helpers/tripwire.js";

/** Send raw bytes on one socket, collect the full reply until the server closes or a quiet period. */
function raw(port: number, payload: string, quietMs = 250): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1", () => socket.write(payload));
    let buf = "";
    let timer: NodeJS.Timeout;
    const settle = (): void => {
      clearTimeout(timer);
      socket.destroy();
      resolve(buf);
    };
    socket.on("data", (d) => {
      buf += d.toString("latin1");
      clearTimeout(timer);
      timer = setTimeout(settle, quietMs);
    });
    socket.on("error", (e) => {
      // A reset/refused after we captured a response is fine.
      if (buf.length > 0) settle();
      else reject(e);
    });
    socket.on("close", settle);
    timer = setTimeout(settle, quietMs * 4);
  });
}

/** Count how many HTTP response status lines appear — >1 means the server processed a smuggled request. */
function countResponses(text: string): number {
  return (text.match(/HTTP\/1\.[01] \d{3}/g) ?? []).length;
}

describe("ZH-002 request smuggling / framing ambiguity", () => {
  let app: RunningApp;
  let hits: string[];

  before(async () => {
    const a = makeApp();
    hits = [];
    a.use(a.json?.() ?? ((_q, _s, n) => n()));
    a.post("/", (req, res) => {
      hits.push(req.url ?? "");
      res.json({ ok: true });
    });
    a.get("/", (_req, res) => res.json({ ok: true }));
    a.post("/smuggled", (req, res) => {
      hits.push("SMUGGLED");
      res.json({ smuggled: true });
    });
    app = await start(a);
  });

  after(async () => {
    await app.close();
  });

  test("Content-Length + Transfer-Encoding together does not smuggle a second request", async () => {
    // Classic CL.TE desync attempt: body after the chunk terminator would be a
    // second request if CL won. Node must reject or frame canonically.
    const payload =
      "POST / HTTP/1.1\r\n" +
      "Host: t\r\n" +
      "Content-Length: 6\r\n" +
      "Transfer-Encoding: chunked\r\n" +
      "\r\n" +
      "0\r\n" +
      "\r\n" +
      "POST /smuggled HTTP/1.1\r\nHost: t\r\nContent-Length: 0\r\n\r\n";
    const reply = await raw(app.port, payload);
    assert.ok(!hits.includes("SMUGGLED"), "a smuggled request reached a handler");
    assert.ok(countResponses(reply) <= 1, `expected at most one response, saw:\n${reply}`);
  });

  test("two conflicting Content-Length headers are rejected, not guessed", async () => {
    const payload =
      "POST / HTTP/1.1\r\n" + "Host: t\r\n" + "Content-Length: 6\r\n" + "Content-Length: 5\r\n" + "\r\n" + "AAAAAA";
    const reply = await raw(app.port, payload);
    // Node's parser rejects duplicate/inconsistent CL with a 400 and closes.
    assert.match(reply, /HTTP\/1\.[01] 400/, `expected 400 for conflicting CL, got:\n${reply}`);
    assert.ok(!hits.includes("SMUGGLED"));
  });

  test("malformed chunked body does not desync", async () => {
    const payload =
      "POST / HTTP/1.1\r\n" +
      "Host: t\r\n" +
      "Transfer-Encoding: chunked\r\n" +
      "\r\n" +
      "zz\r\n" + // invalid chunk size
      "POST /smuggled HTTP/1.1\r\nHost: t\r\nContent-Length: 0\r\n\r\n";
    const reply = await raw(app.port, payload);
    assert.ok(!hits.includes("SMUGGLED"), "malformed chunk smuggled a request");
    assert.ok(countResponses(reply) <= 1, `expected at most one response, saw:\n${reply}`);
  });

  test("a normal keep-alive pipeline still works (control)", async () => {
    const payload =
      "GET / HTTP/1.1\r\nHost: t\r\nConnection: keep-alive\r\n\r\n" +
      "GET / HTTP/1.1\r\nHost: t\r\nConnection: close\r\n\r\n";
    const reply = await raw(app.port, payload);
    // Two *legitimate* pipelined requests → two responses is correct, not smuggling.
    assert.equal(countResponses(reply), 2, `expected 2 pipelined responses, saw:\n${reply}`);
  });
});

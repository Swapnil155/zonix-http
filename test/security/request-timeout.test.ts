// ZH-004 · CWE-400 · slowloris / connection & timeout hardening.
//
// The server pins safe slow-client timeouts regardless of the Node version's
// own defaults, and exposes them as overridable options. A client that opens a
// socket and dribbles headers must not hold it forever.
import assert from "node:assert/strict";
import net from "node:net";
import { describe, test } from "node:test";
import { ErrorCode, type ZonixError } from "../../lib/index.js";
import { makeApp, start } from "../helpers/make-app.js";
import "../helpers/tripwire.js";

describe("ZH-004 request/timeout hardening", () => {
  test("safe defaults are pinned on the server regardless of Node's own", () => {
    const app = makeApp();
    assert.equal(app.server.headersTimeout, 60_000);
    assert.equal(app.server.requestTimeout, 300_000);
    assert.equal(app.server.keepAliveTimeout, 5_000);
  });

  test("each timeout is overridable; 0 disables", () => {
    const app = makeApp({
      headersTimeout: 1000,
      requestTimeout: 2000,
      keepAliveTimeout: 0,
    });
    assert.equal(app.server.headersTimeout, 1000);
    assert.equal(app.server.requestTimeout, 2000);
    assert.equal(app.server.keepAliveTimeout, 0);
  });

  test("a negative or non-finite timeout is rejected at construction", () => {
    for (const bad of [-1, NaN, Infinity]) {
      assert.throws(
        () => makeApp({ headersTimeout: bad }),
        (err: unknown) => (err as ZonixError).code === ErrorCode.INVALID_ARGUMENT,
        String(bad),
      );
    }
  });

  test("an idle keep-alive socket is closed by the server after keepAliveTimeout", async () => {
    // keepAliveTimeout is enforced promptly by Node once a response completes,
    // independent of the 30s connectionsCheckingInterval that gates the header/
    // request timeouts — so it is the reliable, non-flaky proof that the server
    // reclaims slow/idle connections rather than holding them open forever.
    const app = makeApp({ keepAliveTimeout: 300 });
    app.get("/", (_req, res) => res.json({ ok: true }));
    const running = await start(app);
    try {
      const closedByServer = await new Promise<boolean>((resolve) => {
        const socket = net.connect(running.port, "127.0.0.1", () => {
          socket.write("GET / HTTP/1.1\r\nHost: t\r\nConnection: keep-alive\r\n\r\n");
        });
        let gotResponse = false;
        let done = false;
        const finish = (v: boolean): void => {
          if (done) return;
          done = true;
          socket.destroy();
          resolve(v);
        };
        socket.on("data", () => {
          gotResponse = true; // response arrived; now stay idle and wait to be closed
        });
        // Server-initiated FIN after the idle timeout ends the socket.
        socket.on("end", () => finish(gotResponse));
        socket.on("close", () => finish(gotResponse));
        setTimeout(() => finish(false), 3000);
      });
      assert.ok(closedByServer, "server did not reclaim an idle keep-alive socket");
    } finally {
      await running.close();
    }
  });
});

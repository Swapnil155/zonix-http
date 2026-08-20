import type { AddressInfo } from "node:net";
import zonix, { type Zonix, type ZonixError, type ZonixOptions } from "../lib/index.js";

/**
 * Create an app for a test. Warnings are off by default so intentional misuse
 * (double `next()`, thrown handlers) does not spam the test output.
 */
export function makeApp(options: ZonixOptions = { dev: false }): Zonix {
  return zonix(options);
}

export interface RunningApp {
  url: string;
  port: number;
  close: () => Promise<void>;
}

/** Listen on an ephemeral port. Always pair with `await server.close()` in `after`. */
export function start(app: Zonix): Promise<RunningApp> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const address = app.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        port: address.port,
        close: () =>
          new Promise<void>((done, fail) => {
            server.closeAllConnections();
            server.close((err) => (err ? fail(err) : done()));
          }),
      });
    });
    server.once("error", reject);
  });
}

/** Capture whatever the app's error handler sees, for assertions after the request. */
export function captureErrors(app: Zonix): ZonixError[] {
  const seen: ZonixError[] = [];
  app.handleErr((err, _req, res) => {
    seen.push(err);
    if (err.clientDisconnect) return;
    if (!res.headersSent) res.status(500).json({ error: "handled", code: err.code ?? null });
  });
  return seen;
}

/** Fail the test run if any promise rejection escapes the framework. */
export function trapUnhandledRejections(): { reasons: unknown[]; restore: () => void } {
  const reasons: unknown[] = [];
  const existing = process.listeners("unhandledRejection");
  for (const listener of existing) process.off("unhandledRejection", listener);

  const onRejection = (reason: unknown): void => {
    reasons.push(reason);
  };
  process.on("unhandledRejection", onRejection);

  return {
    reasons,
    restore: () => {
      process.off("unhandledRejection", onRejection);
      for (const listener of existing) process.on("unhandledRejection", listener);
    },
  };
}

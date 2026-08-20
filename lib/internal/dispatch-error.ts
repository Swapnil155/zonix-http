import { isClientDisconnect, markDispatched, toError, type ZonixError } from "../errors/index.js";
import type { ZonixRequest } from "../request.js";
import type { ZonixResponse } from "../response.js";
import type { ErrorHandler } from "../types.js";

/**
 * The single funnel for everything that goes wrong.
 *
 * Never rejects: a failure in here is logged and swallowed rather than escaping
 * as an unhandled rejection. Both the middleware chain and the response's
 * out-of-band error sink land here, so there is exactly one place that decides
 * what a failed request looks like on the wire.
 */
export async function dispatchError(
  thrown: unknown,
  req: ZonixRequest,
  res: ZonixResponse,
  handler: ErrorHandler | undefined,
): Promise<void> {
  markDispatched(thrown);
  const err = toError(thrown);
  markDispatched(err);
  // Decision 6 plus one extension: an aborted write surfaces as
  // ERR_STREAM_DESTROYED rather than one of the socket codes, so a request
  // whose peer has verifiably gone counts as a disconnect regardless of code.
  if (isClientDisconnect(err) || (req.destroyed && !res.writableFinished)) {
    err.clientDisconnect = true;
  }

  // Past the point of a clean response: kill the socket, then still let the app
  // observe the error for logging, with any write attempt swallowed.
  if (res.headersSent || res.writableEnded) {
    try {
      req.socket?.destroy();
    } catch {
      /* socket already gone */
    }
    await notifyQuietly(err, req, res, handler);
    return;
  }

  if (handler === undefined) {
    defaultErrorResponse(err, res);
    return;
  }

  try {
    if (writable(res)) res.setHeader("Connection", "close");
    await handler(err, req, res);
    // A handler that observed the error without answering still owes a response.
    if (!res.headersSent && !res.writableEnded && writable(res)) {
      defaultErrorResponse(err, res);
    }
  } catch (secondary) {
    console.error("zonix: the registered error handler threw while handling:", err);
    console.error("zonix: error handler failure:", secondary);
    bare500(res);
  }
}

/** The response is already unusable; the app may still want to know. */
async function notifyQuietly(
  err: ZonixError,
  req: ZonixRequest,
  res: ZonixResponse,
  handler: ErrorHandler | undefined,
): Promise<void> {
  if (handler === undefined) {
    if (!err.clientDisconnect) console.error("zonix: error after headers were sent:", err);
    return;
  }
  try {
    await handler(err, req, res);
  } catch {
    /* the response is already unusable; nothing left to report to the client */
  }
}

function defaultErrorResponse(err: ZonixError, res: ZonixResponse): void {
  const status =
    typeof err.status === "number" && err.status >= 400 && err.status <= 599 ? err.status : 500;
  // Client errors may state their reason; server errors never leak internals.
  const message = status < 500 ? err.message : "Internal Server Error";
  try {
    res.status(status).json({ error: message });
  } catch {
    bare500(res);
  }
}

function bare500(res: ZonixResponse): void {
  try {
    if (res.headersSent || res.writableEnded || !writable(res)) {
      res.socket?.destroy();
      return;
    }
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "Internal Server Error" }));
  } catch {
    try {
      res.socket?.destroy();
    } catch {
      /* nothing further to do */
    }
  }
}

function writable(res: ZonixResponse): boolean {
  return res.socket !== null && !res.socket.destroyed;
}

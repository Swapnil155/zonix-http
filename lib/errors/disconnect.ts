import type { ZonixError } from "./index.js";

/**
 * Socket-level codes that mean "the client left", not "we broke".
 *
 * `ERR_STREAM_DESTROYED` is here per amendment A2: an aborted write surfaces as
 * that rather than as a socket errno, which the original list missed.
 */
const DISCONNECT_CODES = new Set([
  "ECONNRESET",
  "EPIPE",
  "ERR_STREAM_PREMATURE_CLOSE",
  "ERR_STREAM_DESTROYED",
]);

/** True when the error is the peer hanging up rather than a server fault. */
export function isClientDisconnect(err: unknown): boolean {
  if (err === null || typeof err !== "object") return false;
  const code = (err as { code?: unknown }).code;
  if (typeof code === "string" && DISCONNECT_CODES.has(code)) return true;
  return (err as ZonixError).clientDisconnect === true;
}

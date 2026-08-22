import { isClientDisconnect } from "./disconnect.js";

/** Every error reaching a handler is normalized to an `Error` carrying these optional tags. */
export interface ZonixError extends Error {
  /** Stable machine-readable code, present on all framework-raised errors. */
  code?: string;
  /** Suggested HTTP status. The default error responder honours it. */
  status?: number;
  /** True when the peer went away mid-response; safe to skip logging. */
  clientDisconnect?: boolean;
}

export { isClientDisconnect } from "./disconnect.js";

/** Stable error codes. Framework-raised errors always carry one of these on `err.code`. */
export const ErrorCode = {
  /** Route path could not be percent-decoded. */
  BAD_ENCODING: "ERR_ZONIX_BAD_ENCODING",
  /** Two handlers registered for the same method + path. */
  DUPLICATE_ROUTE: "ERR_ZONIX_DUPLICATE_ROUTE",
  /** Route pattern is not registrable (bad wildcard, missing leading slash, ...). */
  INVALID_ROUTE: "ERR_ZONIX_INVALID_ROUTE",
  /** Bad argument to a public API. */
  INVALID_ARGUMENT: "ERR_ZONIX_INVALID_ARGUMENT",
  /** Second registration of a single-slot handler (`handleErr`, `fallback`). */
  ALREADY_REGISTERED: "ERR_ZONIX_ALREADY_REGISTERED",
  /** Write attempted after the head was flushed. */
  HEADERS_SENT: "ERR_ZONIX_HEADERS_SENT",
  /** `res.sendFile()` target does not exist. */
  FILE_NOT_FOUND: "ERR_ZONIX_FILE_NOT_FOUND",
  /** `res.sendFile()` target is a directory or other non-file. */
  NOT_A_FILE: "ERR_ZONIX_NOT_A_FILE",
  /** Extension has no MIME mapping and no explicit type was passed. */
  UNKNOWN_MIME: "ERR_ZONIX_UNKNOWN_MIME",
  /** Body was not valid JSON. */
  INVALID_JSON: "ERR_ZONIX_INVALID_JSON",
  /** Body exceeded the configured limit. */
  PAYLOAD_TOO_LARGE: "ERR_ZONIX_PAYLOAD_TOO_LARGE",
  /** Static path escaped the served root. */
  FORBIDDEN_PATH: "ERR_ZONIX_FORBIDDEN_PATH",
  /** `res.format` found no acceptable representation (HTTP 406). */
  NOT_ACCEPTABLE: "ERR_ZONIX_NOT_ACCEPTABLE",
  PRECONDITION_FAILED: "ERR_ZONIX_PRECONDITION_FAILED",
  RANGE_NOT_SATISFIABLE: "ERR_ZONIX_RANGE_NOT_SATISFIABLE",
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

/**
 * Errors already handed to the central dispatcher. Used to keep an error that a
 * handler both awaited and leaked (e.g. an ignored `sendFile` promise) from being
 * reported twice. A WeakSet keeps the tag off the error object itself.
 */
const dispatched = new WeakSet<object>();

/** Record that this error has reached the central dispatcher. */
export function markDispatched(err: unknown): void {
  if (err !== null && (typeof err === "object" || typeof err === "function")) {
    dispatched.add(err as object);
  }
}

/** True when this error has already been dispatched once. */
export function wasDispatched(err: unknown): boolean {
  return (
    err !== null &&
    (typeof err === "object" || typeof err === "function") &&
    dispatched.has(err as object)
  );
}

/**
 * Build a tagged framework error. `fn` is the public function to cut the stack at,
 * so traces start at the user's call site instead of inside zonix.
 */
export function frameworkError(
  message: string,
  fn: (...args: never[]) => unknown,
  code: ErrorCodeValue,
  status?: number,
): ZonixError {
  const err: ZonixError = new Error(message);
  err.code = code;
  if (status !== undefined) err.status = status;
  Error.captureStackTrace(err, fn);
  return err;
}

/** Coerce anything thrown (strings, objects, undefined) into a real Error, tagging disconnects. */
export function toError(thrown: unknown): ZonixError {
  const err: ZonixError =
    thrown instanceof Error
      ? thrown
      : Object.assign(new Error(`Non-error thrown: ${safeStringify(thrown)}`), {
          thrown,
        });
  if (isClientDisconnect(thrown)) err.clientDisconnect = true;
  return err;
}

function safeStringify(value: unknown): string {
  try {
    return typeof value === "string" ? value : (JSON.stringify(value) ?? String(value));
  } catch {
    return String(value);
  }
}

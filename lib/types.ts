import type { ZonixRequest } from "./request.js";
import type { ZonixResponse } from "./response.js";

/** Frozen, shared empty map — every request that has no params/cookies points at this one object. */
export const EMPTY: StringMap = Object.freeze(Object.create(null)) as StringMap;

export type StringMap = Record<string, string>;

/**
 * Advance the chain. `next()` continues, `next(err)` short-circuits to the error
 * dispatcher. Calling it more than once from the same middleware is inert.
 */
export type Next = (err?: unknown) => void;

/**
 * Handlers may return anything; the value is ignored. A returned promise is
 * watched for rejection (which is treated exactly like `next(err)`). The return
 * type is deliberately `unknown` rather than `void | Promise<void>` so chained
 * calls such as `(req, res) => res.status(204).end()` stay assignable.
 */
export type HandlerResult = unknown;

/** Express-compatible middleware. Returning a rejected promise is the same as `next(err)`. */
export type Middleware = (
  req: ZonixRequest,
  res: ZonixResponse,
  next: Next,
) => HandlerResult;

/** Terminal route handler. `next` is accepted so plain `(req, res)` functions stay assignable. */
export type Handler = (req: ZonixRequest, res: ZonixResponse, next: Next) => HandlerResult;

/** Central error handler registered with `app.handleErr()`. */
export type ErrorHandler = (
  err: ZonixError,
  req: ZonixRequest,
  res: ZonixResponse,
) => HandlerResult;

/** Every error reaching a handler is normalized to an `Error` carrying these optional tags. */
export interface ZonixError extends Error {
  /** Stable machine-readable code, present on all framework-raised errors. */
  code?: string;
  /** Suggested HTTP status. The default error responder honours it. */
  status?: number;
  /** True when the peer went away mid-response; safe to skip logging. */
  clientDisconnect?: boolean;
}

export type HttpMethod = "get" | "post" | "put" | "patch" | "delete" | "head" | "options";

export interface ZonixOptions {
  /** Emit warnings for misuse (double `next()`, etc.). Defaults to `NODE_ENV !== "production"`. */
  dev?: boolean;
}

import type { ZonixError } from "./errors/index.js";
import type { ZonixRequest } from "./request.js";
import type { ZonixResponse } from "./response.js";

export type StringMap = Record<string, string>;

export { EMPTY } from "./internal/constants.js";
export type { ZonixError } from "./errors/index.js";

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
export type Middleware = (req: ZonixRequest, res: ZonixResponse, next: Next) => HandlerResult;

/** Terminal route handler. `next` is accepted so plain `(req, res)` functions stay assignable. */
export type Handler = (req: ZonixRequest, res: ZonixResponse, next: Next) => HandlerResult;

/** Central error handler registered with `app.handleErr()`. */
export type ErrorHandler = (
  err: ZonixError,
  req: ZonixRequest,
  res: ZonixResponse,
) => HandlerResult;

export type HttpMethod = "get" | "post" | "put" | "patch" | "delete" | "head" | "options";

export interface ZonixOptions {
  /** Emit warnings for misuse (double `next()`, etc.). Defaults to `NODE_ENV !== "production"`. */
  dev?: boolean;
}

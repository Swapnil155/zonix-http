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
  /**
   * Who is allowed to set `X-Forwarded-*`. **Off by default**, which is the
   * safe default: with it off, `req.ip` is the socket address and no forwarded
   * header can influence anything.
   *
   * Accepts `true` (trust everything - only behind a proxy you control), a hop
   * count, an IP or CIDR string, a comma-separated list, an array, or a
   * predicate. The names `loopback`, `linklocal` and `uniquelocal` expand to
   * their usual ranges for both IPv4 and IPv6.
   */
  trustProxy?: TrustProxyOption;
  /**
   * How many trailing host labels are the domain rather than a subdomain.
   * Defaults to 2, so `a.b.example.com` has subdomains `["b", "a"]`.
   */
  subdomainOffset?: number;
  /**
   * Secret used to sign cookies (`res.cookie(..., { signed: true })`) and to
   * verify them on the way back in. Without it, signing throws rather than
   * silently emitting an unsigned cookie.
   */
  cookieSecret?: string;
  /**
   * Entity tags on `send`/`json`/`sendFile` bodies, enabling 304s for
   * conditional requests. **Off by default** (performance rule 4): on means
   * hashing every response body. `true` or `"weak"` emits `W/"..."` tags
   * (Express's default); `"strong"` emits strong ones; a function receives
   * the body Buffer and returns a tag or `undefined`. Per route, use the
   * `etag()` middleware instead.
   */
  etag?: EtagOption;
}

export type EtagGenerator = (body: Buffer) => string | undefined;
export type EtagOption = boolean | "weak" | "strong" | EtagGenerator;

/** `(address, hopIndex) => isTrusted`. */
export type TrustPredicate = (address: string | undefined, hop: number) => boolean;

export type TrustProxyOption = boolean | number | string | readonly string[] | TrustPredicate;

/** Settings after compilation, shared by every request the app serves. */
export interface ZonixSettings {
  trust: TrustPredicate;
  subdomainOffset: number;
  /** Secret for signed cookies; signing throws when it is absent. */
  cookieSecret?: string | undefined;
  /** Body tag generator, or undefined when ETags are off. */
  etag?: EtagGenerator | undefined;
}

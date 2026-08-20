import type { ZonixRequest } from "../request.js";
import type { ZonixResponse } from "../response.js";
import type { Middleware } from "../types.js";

/** Decide per request: `true` reflects the caller's origin, a string pins one. */
export type OriginResolver = (origin: string | undefined, req: ZonixRequest) => boolean | string;

export interface CorsOptions {
  /**
   * Allowed origin(s). `"*"` (default) allows any; a string or array allows an
   * exact match; `true` reflects whatever the caller sent; a function decides.
   */
  origin?: string | string[] | boolean | OriginResolver;
  /** Methods advertised on preflight. Defaults to the common six. */
  methods?: string | string[];
  /** Headers advertised on preflight. Defaults to reflecting what was asked for. */
  allowedHeaders?: string | string[];
  /** Response headers the browser may expose to script. */
  exposedHeaders?: string | string[];
  /** Send `Access-Control-Allow-Credentials: true`. */
  credentials?: boolean;
  /** Preflight cache lifetime in seconds. */
  maxAge?: number;
  /** Status for a short-circuited preflight. Defaults to 204. */
  optionsSuccessStatus?: number;
}

const DEFAULT_METHODS = "GET,HEAD,PUT,PATCH,POST,DELETE";

/**
 * Cross-origin resource sharing.
 *
 * A preflight (`OPTIONS` carrying `Access-Control-Request-Method`) is answered
 * here and never reaches the router. Everything else gets the response headers
 * added and continues down the chain. An origin that is not allowed simply gets
 * no `Access-Control-Allow-Origin`, which is what makes the browser refuse it.
 */
export function cors(options: CorsOptions = {}): Middleware {
  const origin = options.origin ?? "*";
  const methods = join(options.methods) ?? DEFAULT_METHODS;
  const allowedHeaders = join(options.allowedHeaders);
  const exposedHeaders = join(options.exposedHeaders);
  const credentials = options.credentials === true;
  const maxAge = options.maxAge;
  const successStatus = options.optionsSuccessStatus ?? 204;

  return function corsMiddleware(req, res, next) {
    const requestOrigin = req.headers.origin;
    const allowed = resolveOrigin(origin, requestOrigin, req);

    if (allowed !== undefined) {
      // "*" cannot be combined with credentials, so reflect the real origin instead.
      if (allowed === "*" && credentials && requestOrigin !== undefined) {
        res.setHeader("Access-Control-Allow-Origin", requestOrigin);
        vary(res, "Origin");
      } else {
        res.setHeader("Access-Control-Allow-Origin", allowed);
        if (allowed !== "*") vary(res, "Origin");
      }
      if (credentials) res.setHeader("Access-Control-Allow-Credentials", "true");
    } else if (origin !== "*") {
      // The answer depends on the caller even when it is "no".
      vary(res, "Origin");
    }

    const isPreflight =
      req.method?.toUpperCase() === "OPTIONS" &&
      req.headers["access-control-request-method"] !== undefined;

    if (!isPreflight) {
      if (exposedHeaders !== undefined) {
        res.setHeader("Access-Control-Expose-Headers", exposedHeaders);
      }
      return next();
    }

    res.setHeader("Access-Control-Allow-Methods", methods);

    if (allowedHeaders !== undefined) {
      res.setHeader("Access-Control-Allow-Headers", allowedHeaders);
    } else {
      const requested = req.headers["access-control-request-headers"];
      if (requested !== undefined) res.setHeader("Access-Control-Allow-Headers", requested);
      vary(res, "Access-Control-Request-Headers");
    }

    if (maxAge !== undefined) res.setHeader("Access-Control-Max-Age", String(maxAge));

    res.statusCode = successStatus;
    res.setHeader("Content-Length", 0);
    res.end();
  };
}

/** The value for `Access-Control-Allow-Origin`, or `undefined` when not allowed. */
function resolveOrigin(
  configured: string | string[] | boolean | OriginResolver,
  requestOrigin: string | undefined,
  req: ZonixRequest,
): string | undefined {
  if (configured === false) return undefined;
  if (configured === true) return requestOrigin;
  if (typeof configured === "function") {
    const decision = configured(requestOrigin, req);
    if (decision === true) return requestOrigin;
    if (decision === false) return undefined;
    return decision;
  }
  if (typeof configured === "string") {
    if (configured === "*") return "*";
    return configured === requestOrigin ? configured : undefined;
  }
  return requestOrigin !== undefined && configured.includes(requestOrigin)
    ? requestOrigin
    : undefined;
}

/** Append to `Vary` without repeating a field that is already listed. */
function vary(res: ZonixResponse, field: string): void {
  const current = res.getHeader("Vary");
  if (current === undefined) {
    res.setHeader("Vary", field);
    return;
  }
  const existing = String(current);
  const listed = existing
    .split(",")
    .some((part) => part.trim().toLowerCase() === field.toLowerCase());
  if (!listed) res.setHeader("Vary", `${existing}, ${field}`);
}

function join(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value.join(",") : value;
}

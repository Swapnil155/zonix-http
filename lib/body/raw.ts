import { typeIs } from "../compat/request.js";
import type { Middleware } from "../types.js";
import { readBody, toBytes } from "./read.js";
import { normalizeTypes } from "./urlencoded.js";

export interface RawOptions {
  /** Maximum body size, as `parseJSON` accepts it. Defaults to `"100kb"`. */
  limit?: string | number;
  /** Content type(s) to buffer, as `req.is` understands them. Defaults to `application/octet-stream`. */
  type?: string | string[];
}

/**
 * Buffer a request body into `req.body` as a `Buffer`, untouched.
 *
 * Matching content types only (default `application/octet-stream`; pass
 * a star-slash-star pattern for everything); the byte limit is exact (413) and an empty body
 * is an empty Buffer. Other requests pass through with `req.body` untouched.
 */
export function raw(options: RawOptions = {}): Middleware {
  const limit = toBytes(options.limit ?? "100kb", "raw()");
  const types = normalizeTypes(options.type, "application/octet-stream");
  return function rawMiddleware(req, _res, next) {
    if (req.body !== undefined) return next();
    if (!typeIs(req.headers, types)) return next();
    readBody(req, limit, (err, buf) => {
      if (err !== undefined) return next(err);
      req.body = buf;
      next();
    });
  };
}

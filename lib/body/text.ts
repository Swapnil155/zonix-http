import { typeIs } from "../compat/request.js";
import type { Middleware } from "../types.js";
import { contentCharset, nodeEncoding, readBody, toBytes, unsupportedCharset } from "./read.js";
import { normalizeTypes } from "./urlencoded.js";

export interface TextOptions {
  /** Maximum body size, as `parseJSON` accepts it. Defaults to `"100kb"`. */
  limit?: string | number;
  /** Content type(s) to parse, as `req.is` understands them. Defaults to `text/plain`. */
  type?: string | string[];
  /** Charset assumed when the Content-Type names none. Defaults to `utf-8`. */
  defaultCharset?: string;
}

/**
 * Decode a text body into `req.body` as a string.
 *
 * The Content-Type's `charset` decides the decoding: UTF-8, ISO-8859-1
 * (Latin-1), US-ASCII and UTF-16LE are decoded natively; anything else is a
 * 415 before the body is read (body-parser reaches for iconv-lite there;
 * decision 1 says no). The byte limit is exact (413); an empty body is `""`.
 */
export function text(options: TextOptions = {}): Middleware {
  const limit = toBytes(options.limit ?? "100kb", "text()");
  const types = normalizeTypes(options.type, "text/plain");
  const defaultCharset = (options.defaultCharset ?? "utf-8").toLowerCase();
  return function textMiddleware(req, _res, next) {
    if (req.body !== undefined) return next();
    if (!typeIs(req.headers, types)) return next();
    const charset = contentCharset(req.headers) ?? defaultCharset;
    const encoding = nodeEncoding(charset);
    if (encoding === undefined) return next(unsupportedCharset(charset));
    readBody(req, limit, (err, buf) => {
      if (err !== undefined) return next(err);
      req.body = buf.toString(encoding);
      next();
    });
  };
}

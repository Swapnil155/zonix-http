import { EMPTY, type Middleware, type StringMap } from "../types.js";

/**
 * Parse the `Cookie` header into `req.cookies`.
 *
 * Unsigned only in v1. Values are percent-decoded when they decode cleanly and
 * left verbatim when they do not, so a malformed cookie can never fail a
 * request. The first occurrence of a repeated name wins, matching browsers.
 */
export function cookieParser(): Middleware {
  return function cookieParserMiddleware(req, _res, next) {
    const header = req.headers.cookie;
    if (header === undefined || header.length === 0) {
      req.cookies = EMPTY;
      return next();
    }
    req.cookies = parseCookieHeader(header);
    next();
  };
}

/** Exported for tests; the middleware is the supported entry point. */
export function parseCookieHeader(header: string): StringMap {
  // Null-prototype: a "__proto__" cookie is then plain data, not a hazard.
  const cookies: StringMap = Object.create(null) as StringMap;
  let found = false;
  let start = 0;

  while (start <= header.length) {
    let end = header.indexOf(";", start);
    if (end === -1) end = header.length;

    const pair = header.slice(start, end);
    start = end + 1;

    const eq = pair.indexOf("=");
    if (eq < 1) continue; // no name, or a valueless flag - skip it

    const name = pair.slice(0, eq).trim();
    if (name.length === 0 || Object.prototype.hasOwnProperty.call(cookies, name)) continue;

    // Only the first "=" splits: the value may contain more of them.
    let value = pair.slice(eq + 1).trim();
    if (
      value.length >= 2 &&
      value.charCodeAt(0) === 34 &&
      value.charCodeAt(value.length - 1) === 34
    ) {
      value = value.slice(1, -1);
    }
    cookies[name] = decode(value);
    found = true;
  }

  return found ? cookies : EMPTY;
}

function decode(value: string): string {
  if (value.indexOf("%") === -1) return value;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

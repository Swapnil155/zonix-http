import { EMPTY } from "../internal/constants.js";
import type { StringMap } from "../types.js";

/**
 * The default query parser: flat, `URLSearchParams`-backed.
 *
 * Repeated keys collapse to the last value. The result is a plain mutable
 * object with a null prototype (as Express's parser produces), so a `__proto__`
 * key is inert data rather than a pollution vector; an empty query returns the
 * shared frozen `EMPTY`.
 */
export function parseQuery(url: string): StringMap {
  const q = url.indexOf("?");
  if (q === -1 || q === url.length - 1) return EMPTY;

  const out: StringMap = Object.create(null) as StringMap;
  let found = false;
  for (const [key, value] of new URLSearchParams(url.slice(q + 1))) {
    out[key] = value;
    found = true;
  }
  return found ? out : EMPTY;
}

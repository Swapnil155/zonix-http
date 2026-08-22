/**
 * Conditional-GET freshness, inlined from `fresh@0.5.2` (the package Express
 * uses for `req.fresh` and for 304s in `send`/`sendFile`). Pinned by
 * differential test; every acceptance quirk below is the oracle's, on purpose.
 *
 * Linear scans only (decision 11): the original's one regex — the
 * `no-cache` directive test on Cache-Control — is a comma-split with
 * JS-`\s` trimming here, which is exactly what `(?:^|,)\s*?no-cache\s*?(?:,|$)`
 * accepts.
 */
import { isWhitespace } from "../negotiation/index.js";

export interface FreshRequestHeaders {
  "if-modified-since"?: string | undefined;
  "if-none-match"?: string | undefined;
  "cache-control"?: string | undefined;
}

export interface FreshResponseHeaders {
  etag?: string | undefined;
  "last-modified"?: string | undefined;
}

/**
 * `true` when the client's cached copy is still good and a 304 may be sent.
 *
 * Landmine, preserved from the oracle: `If-None-Match: *` is unconditional —
 * it skips the ETag comparison entirely, so a request carrying only `*`
 * against a response with no validator at all is fresh.
 */
export function fresh(req: FreshRequestHeaders, res: FreshResponseHeaders): boolean {
  const modifiedSince = req["if-modified-since"];
  const noneMatch = req["if-none-match"];
  if (!modifiedSince && !noneMatch) return false;

  const cacheControl = req["cache-control"];
  if (cacheControl && hasNoCache(cacheControl)) return false;

  if (noneMatch && noneMatch !== "*") {
    const etag = res.etag;
    if (!etag) return false;
    let stale = true;
    for (const match of parseTokenList(noneMatch)) {
      if (match === etag || match === "W/" + etag || "W/" + match === etag) {
        stale = false;
        break;
      }
    }
    if (stale) return false;
  }

  if (modifiedSince) {
    const lastModified = res["last-modified"];
    const modifiedStale =
      !lastModified || !(parseHttpDate(lastModified) <= parseHttpDate(modifiedSince));
    if (modifiedStale) return false;
  }

  return true;
}

/** `Date.parse`, NaN for anything it rejects — so a bad date is never fresh. */
export function parseHttpDate(date: string): number {
  const timestamp = Date.parse(date);
  return typeof timestamp === "number" ? timestamp : NaN;
}

/**
 * The oracle's token-list split: commas separate, runs of spaces (0x20 only)
 * are trimmed from the front of each token, and everything else — tabs
 * included — is part of the token.
 */
export function parseTokenList(str: string): string[] {
  const list: string[] = [];
  let start = 0;
  let end = 0;
  for (let i = 0; i < str.length; i++) {
    switch (str.charCodeAt(i)) {
      case 0x20:
        if (start === end) start = end = i + 1;
        break;
      case 0x2c:
        list.push(str.substring(start, end));
        start = end = i + 1;
        break;
      default:
        end = i + 1;
        break;
    }
  }
  list.push(str.substring(start, end));
  return list;
}

/** Does a comma-separated Cache-Control carry a bare `no-cache` directive? */
function hasNoCache(value: string): boolean {
  let from = 0;
  while (from <= value.length) {
    let to = value.indexOf(",", from);
    if (to === -1) to = value.length;
    let a = from;
    let b = to;
    while (a < b && isWhitespace(value.charCodeAt(a))) a++;
    while (b > a && isWhitespace(value.charCodeAt(b - 1))) b--;
    if (b - a === 8 && value.startsWith("no-cache", a)) return true;
    from = to + 1;
  }
  return false;
}

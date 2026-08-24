import { ErrorCode, frameworkError } from "../errors/index.js";

/**
 * Route path helpers: segment splitting, the canonical form used for duplicate
 * detection, and percent-decoding.
 */

/**
 * Split into segments, dropping empties. This collapses repeated slashes and
 * makes the trailing-slash policy fall out for free: `/users` and `/users/`
 * produce the same segment list, so they are the same route.
 */
export function splitPath(path: string): string[] {
  const segments: string[] = [];
  let start = 1; // every path starts with "/"
  for (let i = 1; i <= path.length; i++) {
    if (i === path.length || path.charCodeAt(i) === 47 /* '/' */) {
      if (i > start) segments.push(path.slice(start, i));
      start = i + 1;
    }
  }
  return segments;
}

/** Canonical form used for duplicate detection and the exact-match fast path. */
export function normalize(path: string): string {
  const segments = splitPath(path);
  return segments.length === 0 ? "/" : `/${segments.join("/")}`;
}

/**
 * Percent-decode one segment.
 *
 * @throws a 400-tagged framework error when the escape is malformed, or when the
 * decoded segment contains a NUL byte (`%00`). A NUL is never legitimate in a
 * path and can truncate a downstream filesystem or string operation
 * (CWE-158/CWE-626), so a param value can never carry one to a handler.
 */
export function decodeSegment(segment: string, path: string): string {
  const decoded = segment.indexOf("%") === -1 ? segment : decodePercent(segment, path);
  if (decoded.indexOf("\0") !== -1) {
    throw frameworkError(`Null byte in path: ${path}`, decodeSegment, ErrorCode.BAD_ENCODING, 400);
  }
  return decoded;
}

function decodePercent(segment: string, path: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    throw frameworkError(`Cannot decode path: ${path}`, decodeSegment, ErrorCode.BAD_ENCODING, 400);
  }
}

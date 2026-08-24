import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { ErrorCode, frameworkError } from "../errors/index.js";
import { statTag } from "../http/etag.js";
import { DEFAULT_MIME, lookupMime } from "../http/mime.js";
import { FileCache } from "../internal/file-cache.js";
import { ZonixResponse } from "../response.js";
import type { Middleware } from "../types.js";

export interface ServeStaticOptions {
  /** File served for a directory request. Pass `false` to 404 directories instead. */
  index?: string | false;
  /**
   * What to do with dotfiles (`.env`, `.git/config`). `"ignore"` (default) falls
   * through to the next middleware; `"allow"` serves them.
   */
  dotfiles?: "ignore" | "allow";
  /**
   * Opt-in in-memory cache of raw file bytes, LRU by bytes up to `maxBytes`.
   * Off by default. Every hit still costs one `stat()`: an entry whose mtime
   * or size changed is evicted and reread, so a cached response is never
   * stale after the file changes. Conditional requests (304), byte ranges
   * (206) and `compression()` all operate on top of the cached bytes.
   */
  cache?: { maxBytes: number };
  /**
   * `Cache-Control: public, max-age=...` for every served file (including
   * 304 and 206 responses). Milliseconds, or a duration string (`"30s"`,
   * `"5m"`, `"12h"`, `"7d"`, `"1w"`, `"1y"`). Clamped to one year, `send`'s
   * ceiling. **Nothing is sent unless set** - a deliberate deviation from
   * Express, which defaults to `max-age=0`; when set, the wire format
   * matches `send`'s exactly. A handler that already set `Cache-Control`
   * wins.
   */
  maxAge?: number | string;
  /** Append `, immutable`: for fingerprinted assets that never change under the same URL. */
  immutable?: boolean;
}

/**
 * Serve files from `root`.
 *
 * A miss calls `next()` rather than answering 404, so routes registered after it
 * still get their chance. A path that escapes `root` is a 403 — checked after
 * resolution, so `..` segments and their encoded forms are both caught.
 */
export function serveStatic(root: string, options: ServeStaticOptions = {}): Middleware {
  if (typeof root !== "string" || root.length === 0) {
    throw frameworkError(
      "serveStatic() requires a root directory",
      serveStatic,
      ErrorCode.INVALID_ARGUMENT,
    );
  }
  const base = path.resolve(root);
  const prefix = base.endsWith(path.sep) ? base : base + path.sep;
  const index = options.index === undefined ? "index.html" : options.index;
  const allowDotfiles = options.dotfiles === "allow";
  const cache = compileCache(options.cache);
  const cacheControl = compileCacheControl(options);

  // The canonical (symlink-resolved) root, resolved once and cached. The lexical
  // check below blocks `../`, but not a symlink *inside* the root that points
  // out of it: `secret -> /etc` makes `/secret/passwd` resolve lexically inside
  // while `stat` follows it out (CWE-22/59). Every served file is realpath'd and
  // required to stay under this real root before a byte is read.
  let realRoot: string | undefined;
  let realRootResolved = false;
  const resolveRealRoot = async (): Promise<string | undefined> => {
    if (realRootResolved) return realRoot;
    realRootResolved = true;
    try {
      realRoot = await realpath(base);
    } catch {
      realRoot = undefined; // root missing → every request 404s anyway
    }
    return realRoot;
  };

  return function serveStaticMiddleware(req, res, next) {
    const method = req.method?.toUpperCase();
    if (method !== "GET" && method !== "HEAD") return next();

    let pathname: string;
    try {
      pathname = decodeURIComponent(req.path);
    } catch {
      return next(); // Malformed encoding cannot name a file; let routing decide.
    }
    if (pathname.includes("\0")) {
      return next(forbidden(req.path));
    }

    // Resolve first, then prove the result is still inside the root.
    const target = path.resolve(base, "." + path.sep + pathname);
    if (target !== base && !target.startsWith(prefix)) {
      return next(forbidden(req.path));
    }

    if (!allowDotfiles && hasDotfileSegment(target.slice(base.length))) return next();

    if (cache !== undefined) {
      void (async () => {
        await serveCached(
          cache,
          target,
          index,
          cacheControl,
          await resolveRealRoot(),
          req.path,
          res,
          next,
        );
      })();
      return;
    }

    void (async () => {
      let stats;
      try {
        stats = await stat(target);
      } catch {
        next(); // Missing, unreadable, or not a directory on the way down.
        return;
      }

      let file = target;
      if (stats.isDirectory()) {
        if (index === false) {
          next();
          return;
        }
        file = path.join(target, index);
        try {
          const indexStats = await stat(file);
          if (!indexStats.isFile()) {
            next();
            return;
          }
        } catch {
          next();
          return;
        }
      } else if (!stats.isFile()) {
        next();
        return;
      }

      const real = await realpathWithin(file, await resolveRealRoot());
      if (real === ESCAPED) return next(forbidden(req.path)); // symlink out of root
      if (real === MISSING) return next();
      file = real; // serve the canonical path, not the symlink

      if (cacheControl !== undefined && !res.hasHeader("Cache-Control")) {
        res.setHeader("Cache-Control", cacheControl);
      }
      try {
        // Unlike res.sendFile(), an unmapped extension is served rather than refused:
        // a static directory is expected to hold whatever it holds.
        await res.sendFile(file, lookupMime(file) ?? DEFAULT_MIME);
      } catch (err) {
        next(err);
      }
    })();
  };
}

/**
 * The cached path. One `stat()` per request (two for a directory request, as
 * the plain path also needs): a current entry is sent from memory; a changed
 * or missing one is read, stored when it fits the cap, and sent from the
 * bytes just read. A file whose size differs from its stat by the time it is
 * read is sent but not cached - it was changing under us.
 */
async function serveCached(
  cache: FileCache,
  target: string,
  index: string | false,
  cacheControl: string | undefined,
  realRoot: string | undefined,
  reqPath: string,
  res: ZonixResponse,
  next: (err?: unknown) => void,
): Promise<void> {
  let stats;
  try {
    stats = await stat(target);
  } catch {
    next();
    return;
  }
  let file = target;
  if (stats.isDirectory()) {
    if (index === false) {
      next();
      return;
    }
    file = path.join(target, index);
    try {
      stats = await stat(file);
    } catch {
      next();
      return;
    }
    if (!stats.isFile()) {
      next();
      return;
    }
  } else if (!stats.isFile()) {
    next();
    return;
  }

  const real = await realpathWithin(file, realRoot);
  if (real === ESCAPED) return next(forbidden(reqPath)); // symlink out of root
  if (real === MISSING) return next();
  file = real; // canonical path is also the cache key, deduping symlinks

  const type = lookupMime(file) ?? DEFAULT_MIME;
  if (cacheControl !== undefined && !res.hasHeader("Cache-Control")) {
    res.setHeader("Cache-Control", cacheControl);
  }
  const hit = cache.get(file);
  if (hit !== undefined && FileCache.isCurrent(hit, stats)) {
    try {
      await ZonixResponse.sendCached(res, file, type, stats, hit.body, hit.tag);
    } catch (err) {
      next(err);
    }
    return;
  }
  if (hit !== undefined) cache.delete(file);

  let body: Buffer;
  try {
    body = await readFile(file);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR" || code === "EISDIR") next();
    else next(err);
    return;
  }
  const tag = statTag(stats);
  if (body.byteLength === stats.size) cache.set(file, { body, stats, tag });
  try {
    await ZonixResponse.sendCached(res, file, type, stats, body, tag);
  } catch (err) {
    next(err);
  }
}

function compileCache(option: ServeStaticOptions["cache"]): FileCache | undefined {
  if (option === undefined) return undefined;
  const maxBytes = option.maxBytes;
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
    throw frameworkError(
      `serveStatic(): cache.maxBytes must be a positive number of bytes, received ${String(maxBytes)}`,
      serveStatic,
      ErrorCode.INVALID_ARGUMENT,
    );
  }
  return new FileCache(maxBytes);
}

/** Milliseconds in one year - `send`'s MAX_MAXAGE, the RFC 9111 suggested ceiling. */
const MAX_MAXAGE = 60 * 60 * 24 * 365 * 1000;

const DURATION_UNITS: Record<string, number> = {
  "": 1,
  ms: 1,
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
  w: 7 * 24 * 60 * 60 * 1000,
  y: 365 * 24 * 60 * 60 * 1000,
};

function compileCacheControl(options: ServeStaticOptions): string | undefined {
  if (options.maxAge === undefined && options.immutable === undefined) return undefined;
  const ms = options.maxAge === undefined ? 0 : toMilliseconds(options.maxAge);
  let value = `public, max-age=${Math.floor(Math.min(Math.max(0, ms), MAX_MAXAGE) / 1000)}`;
  if (options.immutable === true) value += ", immutable";
  return value;
}

/** Duration to milliseconds: a number passes through, a string is `<digits><unit>`. */
function toMilliseconds(value: number | string): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) {
      throw frameworkError(
        `serveStatic(): maxAge must be a non-negative number of milliseconds, received ${value}`,
        serveStatic,
        ErrorCode.INVALID_ARGUMENT,
      );
    }
    return value;
  }
  const trimmed = value.trim().toLowerCase();
  let i = 0;
  while (i < trimmed.length) {
    const c = trimmed.charCodeAt(i);
    if ((c >= 48 && c <= 57) || c === 46) i++;
    else break;
  }
  const amount = Number(trimmed.slice(0, i));
  const scale = DURATION_UNITS[trimmed.slice(i).trim()];
  if (i === 0 || !Number.isFinite(amount) || scale === undefined) {
    throw frameworkError(
      `serveStatic(): cannot read maxAge ${JSON.stringify(value)}. Use milliseconds or e.g. "12h", "7d", "1y"`,
      serveStatic,
      ErrorCode.INVALID_ARGUMENT,
    );
  }
  return amount * scale;
}

/** Distinct sentinels so an escaped path (403) is never confused with a missing one (404). */
const ESCAPED = Symbol("escaped-root");
const MISSING = Symbol("missing");

/**
 * Resolve the real (symlink-followed) path of `file` and require it to stay
 * under `realRoot`. Returns the canonical path when contained, {@link ESCAPED}
 * when the real path is outside the root (a symlink pointing out), or
 * {@link MISSING} when it cannot be resolved (gone between stat and open — the
 * TOCTOU window; treated as not-found, never served).
 */
async function realpathWithin(
  file: string,
  realRoot: string | undefined,
): Promise<string | typeof ESCAPED | typeof MISSING> {
  if (realRoot === undefined) return MISSING;
  let real: string;
  try {
    real = await realpath(file);
  } catch {
    return MISSING;
  }
  if (real === realRoot || real.startsWith(realRoot + path.sep)) return real;
  return ESCAPED;
}

function forbidden(requestPath: string): Error {
  return frameworkError(`Forbidden path: ${requestPath}`, forbidden, ErrorCode.FORBIDDEN_PATH, 403);
}

function hasDotfileSegment(relative: string): boolean {
  for (const segment of relative.split(/[\\/]/)) {
    if (segment.length > 1 && segment.charCodeAt(0) === 46 /* '.' */) return true;
  }
  return false;
}

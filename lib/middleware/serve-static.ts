import { readFile, stat } from "node:fs/promises";
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
      void serveCached(cache, target, index, res, next);
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

  const type = lookupMime(file) ?? DEFAULT_MIME;
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

function forbidden(requestPath: string): Error {
  return frameworkError(`Forbidden path: ${requestPath}`, forbidden, ErrorCode.FORBIDDEN_PATH, 403);
}

function hasDotfileSegment(relative: string): boolean {
  for (const segment of relative.split(/[\\/]/)) {
    if (segment.length > 1 && segment.charCodeAt(0) === 46 /* '.' */) return true;
  }
  return false;
}

import { stat } from "node:fs/promises";
import path from "node:path";
import { ErrorCode, frameworkError } from "../errors/index.js";
import { DEFAULT_MIME, lookupMime } from "../http/mime.js";
import type { Middleware } from "../types.js";

export interface ServeStaticOptions {
  /** File served for a directory request. Pass `false` to 404 directories instead. */
  index?: string | false;
  /**
   * What to do with dotfiles (`.env`, `.git/config`). `"ignore"` (default) falls
   * through to the next middleware; `"allow"` serves them.
   */
  dotfiles?: "ignore" | "allow";
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

function forbidden(requestPath: string): Error {
  return frameworkError(`Forbidden path: ${requestPath}`, forbidden, ErrorCode.FORBIDDEN_PATH, 403);
}

function hasDotfileSegment(relative: string): boolean {
  for (const segment of relative.split(/[\\/]/)) {
    if (segment.length > 1 && segment.charCodeAt(0) === 46 /* '.' */) return true;
  }
  return false;
}

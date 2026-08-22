import { compileEtag } from "../http/etag.js";
import { ZonixResponse } from "../response.js";
import type { EtagGenerator, Middleware } from "../types.js";

export interface EtagMiddlewareOptions {
  /** `"weak"` (default, Express's choice), `"strong"`, or your own generator. */
  mode?: "weak" | "strong" | EtagGenerator;
}

/**
 * Route-level ETags: enable entity tags — and the 304s that come with them —
 * for the routes you mount this on, while the app default stays off
 * (performance rule 4). Overrides the app-level `etag` option for those
 * routes.
 *
 *     app.get("/catalog", etag(), (req, res) => res.json(catalog));
 */
export function etag(options: EtagMiddlewareOptions = {}): Middleware {
  const generator = compileEtag(options.mode ?? "weak");
  if (generator === undefined) throw new TypeError("etag(): a generator is required");
  return function etagMiddleware(_req, res, next) {
    ZonixResponse.setEtag(res, generator);
    next();
  };
}

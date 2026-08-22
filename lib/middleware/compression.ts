import type { BrotliOptions, ZlibOptions } from "node:zlib";
import { ErrorCode, frameworkError } from "../errors/index.js";
import { brotliDefaults, type CompressionPlan } from "../internal/compress.js";
import { ZonixResponse } from "../response.js";
import type { ZonixRequest } from "../request.js";
import type { Middleware } from "../types.js";

export interface CompressionOptions {
  /** Minimum body size, in bytes, worth compressing. Defaults to 1024, as the `compression` package does. */
  threshold?: number;
  /** gzip/deflate options (`level`, `memLevel`, ...). */
  zlib?: ZlibOptions;
  /** Brotli options; quality defaults to 4. */
  brotli?: BrotliOptions;
  /** Offer brotli. Defaults to `true`. */
  br?: boolean;
  /** Extra veto after the built-in checks (type, no-transform, HEAD, size). */
  filter?: (req: ZonixRequest, res: ZonixResponse) => boolean;
}

/**
 * Response compression: gzip, deflate or brotli via `node:zlib`, chosen by
 * `Accept-Encoding` through the in-house negotiator (decision 11), with
 * `Vary: Accept-Encoding`, a size threshold, a compressible-type check,
 * `Cache-Control: no-transform` respected, HEAD and 206 left alone, and the
 * result discarded when it is not smaller than the original.
 *
 * Mount it where you want it; responses that never see it pay nothing
 * (performance rule 1). In-memory bodies (`send`/`json`/buffered `sendFile`)
 * compress off the event loop and keep a `Content-Length`; streamed files
 * compress through a transform and go out chunked.
 *
 *     app.use(compression());
 *     app.get("/report", compression({ threshold: 0 }), handler);
 */
export function compression(options: CompressionOptions = {}): Middleware {
  const threshold = options.threshold ?? 1024;
  if (!Number.isFinite(threshold) || threshold < 0) {
    throw frameworkError(
      `compression(): threshold must be a non-negative number of bytes, received ${threshold}`,
      compression,
      ErrorCode.INVALID_ARGUMENT,
    );
  }
  const br = options.br ?? true;
  const plan: CompressionPlan = {
    threshold,
    zlib: options.zlib ?? {},
    brotli: brotliDefaults(options.brotli),
    supported: br ? ["br", "gzip", "deflate", "identity"] : ["gzip", "deflate", "identity"],
    preferred: br ? ["br", "gzip"] : ["gzip"],
    filter: options.filter as CompressionPlan["filter"],
  };
  return function compressionMiddleware(_req, res, next) {
    ZonixResponse.setCompression(res, plan);
    next();
  };
}

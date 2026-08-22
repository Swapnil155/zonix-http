/**
 * The engine behind `compression()`: encoding choice and the zlib calls.
 * Internal — the middleware builds the plan, `ZonixResponse` consults it.
 */
import {
  brotliCompress,
  constants,
  createBrotliCompress,
  createDeflate,
  createGzip,
  deflate,
  gzip,
  type BrotliOptions,
  type ZlibOptions,
} from "node:zlib";
import type { Transform } from "node:stream";
import { preferredEncoding } from "../negotiation/index.js";

export interface CompressionPlan {
  /** Bodies shorter than this many bytes are sent as they are. */
  threshold: number;
  /** Options handed to gzip/deflate. */
  zlib: ZlibOptions;
  /** Options handed to brotli. */
  brotli: BrotliOptions;
  /** Encodings offered, best first — the `compression` package's `br, gzip, deflate, identity`. */
  supported: readonly string[];
  /** Encodings to prefer when the client's q-values tie. */
  preferred: readonly string[];
  /** Optional veto, called with the request and response after the built-in checks. */
  filter?: ((req: unknown, res: unknown) => boolean) | undefined;
}

/** Default brotli quality, as the `compression` package sets it (11 is far too slow for live responses). */
export const DEFAULT_BROTLI_QUALITY = 4;

/**
 * The encoding to use for this client, or `undefined` for identity.
 * Mirrors `compression`'s `negotiator.encoding(SUPPORTED, PREFERRED)`.
 */
export function chooseEncoding(
  acceptEncoding: string | string[] | undefined,
  plan: CompressionPlan,
): string | undefined {
  const header = Array.isArray(acceptEncoding) ? acceptEncoding.join(", ") : acceptEncoding;
  const method = preferredEncoding(header, plan.supported, plan.preferred);
  if (method === undefined || method === "identity") return undefined;
  return method;
}

export function compressBuffer(
  encoding: string,
  body: Buffer,
  plan: CompressionPlan,
  callback: (err: Error | null, result: Buffer) => void,
): void {
  if (encoding === "br") brotliCompress(body, plan.brotli, callback);
  else if (encoding === "deflate") deflate(body, plan.zlib, callback);
  else gzip(body, plan.zlib, callback);
}

export function compressStream(encoding: string, plan: CompressionPlan): Transform {
  if (encoding === "br") return createBrotliCompress(plan.brotli);
  if (encoding === "deflate") return createDeflate(plan.zlib);
  return createGzip(plan.zlib);
}

/** Brotli options with the quality default applied under the caller's params. */
export function brotliDefaults(options: BrotliOptions | undefined): BrotliOptions {
  return {
    ...options,
    params: { [constants.BROTLI_PARAM_QUALITY]: DEFAULT_BROTLI_QUALITY, ...options?.params },
  };
}

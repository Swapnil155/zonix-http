import { ErrorCode, frameworkError } from "../errors/index.js";
import type { Middleware } from "../types.js";

export interface ParseJSONOptions {
  /**
   * Maximum body size. A number is bytes; a string may use `b`, `kb`, `mb` or
   * `gb` (e.g. `"1mb"`). Defaults to `"1mb"`.
   */
  limit?: string | number;
  /**
   * Extra content types to treat as JSON, in addition to `application/json` and
   * any `*+json` type. Compared case-insensitively against the type only.
   */
  type?: string | string[];
}

const UNITS: Readonly<Record<string, number>> = Object.freeze({
  b: 1,
  kb: 1024,
  mb: 1024 * 1024,
  gb: 1024 * 1024 * 1024,
});

/**
 * Parse a JSON request body into `req.body`.
 *
 * Requests without a JSON content type pass straight through untouched, so a
 * GET or a multipart upload is unaffected. An empty body parses to `{}`.
 * Oversized bodies fail with 413 and malformed JSON with 400 — both through
 * `next(err)`, so they land in the central error handler like everything else.
 */
export function parseJSON(options: ParseJSONOptions = {}): Middleware {
  const limit = toBytes(options.limit ?? "1mb");
  const extraTypes = normalizeTypes(options.type);

  return function parseJSONMiddleware(req, _res, next) {
    if (req.body !== undefined) return next();

    const contentType = req.headers["content-type"];
    if (contentType === undefined || !isJSONType(contentType, extraTypes)) return next();

    // Cheap rejection before reading a byte, when the client declared a size.
    const declared = Number(req.headers["content-length"]);
    if (Number.isFinite(declared) && declared > limit) {
      return next(tooLarge(declared, limit));
    }

    // Plain event listeners, not `for await`: the async iterator costs a
    // promise per chunk, an end-of-stream watcher and async_hooks binding on
    // every request (ECHO-1 profile: ~8% of self time, plus GC). Listeners
    // read the same bytes with none of that. Every guard below is unchanged:
    // bytes are counted per chunk against the limit, a stream error or a
    // client that goes away mid-body reaches dispatch, and a chunk arriving
    // after the limit is never buffered.
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;

    const finish = (err?: unknown): void => {
      if (done) return;
      done = true;
      req.removeListener("data", onData);
      req.removeListener("end", onEnd);
      req.removeListener("error", onError);
      req.removeListener("close", onClose);
      next(err);
    };

    const onData = (chunk: Buffer): void => {
      size += chunk.byteLength; // bytes, not characters
      if (size > limit) {
        // Stop consuming; the 413 goes out with `Connection: close` from
        // dispatch and the socket closes behind it, so the rest of the body is
        // never read into memory.
        req.pause();
        finish(tooLarge(size, limit));
        return;
      }
      chunks.push(chunk);
    };

    const onEnd = (): void => {
      if (done) return;
      if (size === 0) {
        req.body = {};
        finish();
        return;
      }

      // One chunk is the common case for any body under the socket's high-water
      // mark, and a single chunk needs no concat copy.
      let text =
        chunks.length === 1
          ? (chunks[0] as Buffer).toString("utf8")
          : Buffer.concat(chunks, size).toString("utf8");
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch (err) {
        finish(
          frameworkError(
            `Invalid JSON body: ${(err as Error).message}`,
            parseJSONMiddleware,
            ErrorCode.INVALID_JSON,
            400,
          ),
        );
        return;
      }
      req.body = parsed;
      finish();
    };

    const onError = (err: unknown): void => finish(err);

    // `close` without `end`: the client went away mid-body. The same error the
    // async iterator produced, so disconnect tagging in dispatch is unchanged.
    const onClose = (): void => {
      if (done || req.readableEnded) return;
      const err = new Error("Premature close") as Error & { code: string };
      err.code = "ERR_STREAM_PREMATURE_CLOSE";
      finish(err);
    };

    req.on("data", onData);
    req.once("end", onEnd);
    req.once("error", onError);
    req.once("close", onClose);
  };
}

function tooLarge(size: number, limit: number): Error {
  return frameworkError(
    `Request body is too large: ${size} bytes exceeds the ${limit} byte limit`,
    tooLarge,
    ErrorCode.PAYLOAD_TOO_LARGE,
    413,
  );
}

function isJSONType(header: string, extraTypes: readonly string[]): boolean {
  const type = header.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (type === "application/json" || type.endsWith("+json")) return true;
  return extraTypes.includes(type);
}

function normalizeTypes(type: string | string[] | undefined): readonly string[] {
  if (type === undefined) return [];
  const list = Array.isArray(type) ? type : [type];
  return list.map((t) => t.trim().toLowerCase());
}

/** Turn `"1mb"` / `1048576` into a byte count. */
function toBytes(limit: string | number): number {
  if (typeof limit === "number") {
    if (!Number.isFinite(limit) || limit < 0) {
      throw frameworkError(
        `parseJSON(): limit must be a non-negative number of bytes, received ${limit}`,
        toBytes,
        ErrorCode.INVALID_ARGUMENT,
      );
    }
    return Math.floor(limit);
  }

  const match = /^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/i.exec(limit.trim());
  const value = match?.[1];
  if (value === undefined) {
    throw frameworkError(
      `parseJSON(): cannot read limit ${JSON.stringify(limit)}. Use e.g. "500kb", "2mb" or a byte count`,
      toBytes,
      ErrorCode.INVALID_ARGUMENT,
    );
  }
  const unit = (match?.[2] ?? "b").toLowerCase();
  return Math.floor(Number(value) * (UNITS[unit] as number));
}

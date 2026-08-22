import type { IncomingHttpHeaders } from "node:http";
import { ErrorCode, frameworkError } from "../errors/index.js";
import type { ZonixRequest } from "../request.js";

/**
 * The one body reader every parser shares (decision 13).
 *
 * Plain event listeners, not `for await`: the async iterator costs a promise
 * per chunk, an end-of-stream watcher and async_hooks binding on every request
 * (ECHO-1 profile: ~8% of self time, plus GC). Listeners read the same bytes
 * with none of that. The guards: bytes are counted per chunk against the
 * limit (a chunk past it is never buffered and the request is paused so the
 * 413 goes out with `Connection: close`), a stream error or a client that
 * goes away mid-body reaches dispatch tagged as a disconnect, and a declared
 * Content-Length over the limit is refused before a byte is read.
 *
 * `done(undefined, body)` receives the single chunk itself when there was
 * only one (no concat copy), an empty Buffer for an empty body.
 */
export function readBody(
  req: ZonixRequest,
  limit: number,
  done: (err: unknown, body: Buffer) => void,
): void {
  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > limit) {
    done(tooLarge(declared, limit), EMPTY_BUFFER);
    return;
  }

  const chunks: Buffer[] = [];
  let size = 0;
  let finished = false;

  const finish = (err: unknown, body: Buffer): void => {
    if (finished) return;
    finished = true;
    req.removeListener("data", onData);
    req.removeListener("end", onEnd);
    req.removeListener("error", onError);
    req.removeListener("close", onClose);
    done(err, body);
  };

  const onData = (chunk: Buffer): void => {
    size += chunk.byteLength; // bytes, not characters
    if (size > limit) {
      req.pause();
      finish(tooLarge(size, limit), EMPTY_BUFFER);
      return;
    }
    chunks.push(chunk);
  };

  const onEnd = (): void => {
    if (finished) return;
    if (size === 0) {
      finish(undefined, EMPTY_BUFFER);
      return;
    }
    finish(undefined, chunks.length === 1 ? (chunks[0] as Buffer) : Buffer.concat(chunks, size));
  };

  const onError = (err: unknown): void => finish(err, EMPTY_BUFFER);

  // `close` without `end`: the client went away mid-body. The same error the
  // async iterator produced, so disconnect tagging in dispatch is unchanged.
  const onClose = (): void => {
    if (finished || req.readableEnded) return;
    const err = new Error("Premature close") as Error & { code: string };
    err.code = "ERR_STREAM_PREMATURE_CLOSE";
    finish(err, EMPTY_BUFFER);
  };

  req.on("data", onData);
  req.once("end", onEnd);
  req.once("error", onError);
  req.once("close", onClose);
}

const EMPTY_BUFFER = Buffer.alloc(0);

export function tooLarge(size: number, limit: number): Error {
  return frameworkError(
    `Request body is too large: ${size} bytes exceeds the ${limit} byte limit`,
    tooLarge,
    ErrorCode.PAYLOAD_TOO_LARGE,
    413,
  );
}

const UNITS: Readonly<Record<string, number>> = Object.freeze({
  b: 1,
  kb: 1024,
  mb: 1024 * 1024,
  gb: 1024 * 1024 * 1024,
});

/** Turn `"1mb"` / `1048576` into a byte count. */
export function toBytes(limit: string | number, what: string): number {
  if (typeof limit === "number") {
    if (!Number.isFinite(limit) || limit < 0) {
      throw frameworkError(
        `${what}: limit must be a non-negative number of bytes, received ${limit}`,
        toBytes,
        ErrorCode.INVALID_ARGUMENT,
      );
    }
    return Math.floor(limit);
  }
  const trimmed = limit.trim().toLowerCase();
  let i = 0;
  while (i < trimmed.length) {
    const c = trimmed.charCodeAt(i);
    if ((c >= 48 && c <= 57) || c === 46) i++;
    else break;
  }
  const value = Number(trimmed.slice(0, i));
  const unit = trimmed.slice(i).trim() || "b";
  const factor = UNITS[unit];
  if (i === 0 || Number.isNaN(value) || factor === undefined) {
    throw frameworkError(
      `${what}: cannot read limit ${JSON.stringify(limit)}. Use e.g. "500kb", "2mb" or a byte count`,
      toBytes,
      ErrorCode.INVALID_ARGUMENT,
    );
  }
  return Math.floor(value * factor);
}

/**
 * The `charset` parameter of a Content-Type, lowercased, quotes stripped;
 * `undefined` when absent. A linear scan of the parameter list.
 */
export function contentCharset(headers: IncomingHttpHeaders): string | undefined {
  const header = headers["content-type"];
  if (header === undefined) return undefined;
  let i = header.indexOf(";");
  while (i !== -1) {
    let start = i + 1;
    while (start < header.length && (header[start] === " " || header[start] === "\t")) start++;
    let end = header.indexOf(";", start);
    if (end === -1) end = header.length;
    const param = header.slice(start, end);
    const eq = param.indexOf("=");
    if (eq !== -1 && param.slice(0, eq).trim().toLowerCase() === "charset") {
      let value = param.slice(eq + 1).trim();
      if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      }
      return value.toLowerCase();
    }
    i = end === header.length ? -1 : end;
  }
  return undefined;
}

/** Node's name for a charset label, or `undefined` when it cannot be decoded natively. */
export function nodeEncoding(charset: string): BufferEncoding | undefined {
  switch (charset) {
    case "utf-8":
    case "utf8":
      return "utf8";
    case "iso-8859-1":
    case "latin1":
    case "binary":
      return "latin1";
    case "us-ascii":
    case "ascii":
      return "ascii";
    case "utf-16le":
    case "utf16le":
    case "ucs-2":
    case "ucs2":
      return "utf16le";
    default:
      return undefined;
  }
}

export function unsupportedCharset(charset: string): Error {
  return frameworkError(
    `Unsupported charset "${charset.toUpperCase()}"`,
    unsupportedCharset,
    ErrorCode.UNSUPPORTED_CHARSET,
    415,
  );
}

/** Strip a UTF-8/UTF-16 byte-order mark that a decoder would otherwise keep. */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

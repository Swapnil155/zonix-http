import { createReadStream, readFile as readFileCb, stat as statCb, type Stats } from "node:fs";
import { ServerResponse } from "node:http";
import { pipeline } from "node:stream/promises";
import { ErrorCode, frameworkError, wasDispatched } from "./errors/index.js";
import { DEFAULT_MIME, lookupMime } from "./http/mime.js";
import type { ZonixRequest } from "./request.js";

/** Where an error raised outside the middleware chain is sent. Wired by `Zonix`. */
type ErrorSink = (err: unknown) => void;

/**
 * At or below this size a file is read into one buffer and sent with a single
 * `end()`, instead of being streamed.
 *
 * Streaming a small file is nearly all scaffolding: `createReadStream` allocates
 * a 64KB highWaterMark buffer to move 1KB, and `stream/promises.pipeline` adds
 * abort plumbing and async_hooks binding on top. Profiling file-1kb put 20% of
 * self time in GC, 14% in FastBuffer and 11% in DOMException before this path
 * existed. Backpressure is irrelevant at this size - the payload fits in a
 * single socket write - so the buffered path is both faster and simpler.
 */
const BUFFERED_MAX_BYTES = 32 * 1024;

const JSON_CONTENT_TYPE = "application/json; charset=utf-8";

/**
 * Callback `fs` wrapped in one plain promise each, rather than `node:fs/promises`.
 *
 * The promise API routes through FileHandle and primordial SafePromise layers
 * that showed up as ~5% of self time on the file-1kb profile (`stat @ promises`
 * plus `open @ promises`) for two calls that do almost no work. A single
 * hand-rolled promise per call has the same semantics - the same errno errors
 * arrive at the same place - with none of that scaffolding.
 */
function statAsync(path: string): Promise<Stats> {
  return new Promise((resolve, reject) => {
    statCb(path, (err, stats) => (err ? reject(err) : resolve(stats)));
  });
}

function readFileAsync(path: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    readFileCb(path, (err, data) => (err ? reject(err) : resolve(data)));
  });
}

/**
 * The response object handed to every middleware and handler.
 *
 * Everything stock on `http.ServerResponse` still works; these are additions,
 * installed via `http.createServer({ ServerResponse })` rather than by patching
 * the prototype.
 */
export class ZonixResponse extends ServerResponse<ZonixRequest> {
  #sink: ErrorSink | undefined = undefined;

  /**
   * @internal Wire this response to the app's central error dispatch. Called by
   * `Zonix` for every request; not part of the public API.
   */
  static attachErrorSink(res: ZonixResponse, sink: ErrorSink): void {
    res.#sink = sink;
  }

  /** Set the status code. Chainable: `res.status(201).json(...)`. */
  status(code: number): this {
    if (!Number.isInteger(code) || code < 100 || code > 599) {
      throw frameworkError(
        `res.status() expects an integer between 100 and 599, received ${String(code)}`,
        this.status,
        ErrorCode.INVALID_ARGUMENT,
      );
    }
    this.statusCode = code;
    return this;
  }

  /** Serialize `data` as JSON and end the response. */
  json(data: unknown): void {
    this.#assertOpen(this.json);
    // A Buffer, not a string: sending the string and measuring it with
    // Buffer.byteLength was tried and measured slightly WORSE (framework
    // self-time 3.10% -> 3.39% on the hello profile), so the encode stays here.
    const body = Buffer.from(JSON.stringify(data === undefined ? null : data), "utf8");
    if (this.hasHeader("Content-Type")) {
      this.setHeader("Content-Length", body.byteLength);
    } else {
      // One writeHead instead of two setHeader calls plus the implicit head
      // write. Headers already set through setHeader are still merged in by
      // node:http, with these taking precedence, so callers that set their own
      // headers first are unaffected.
      this.writeHead(this.statusCode, {
        "Content-Type": JSON_CONTENT_TYPE,
        "Content-Length": body.byteLength,
      });
    }
    this.end(body);
  }

  /** Send a `Location` redirect. Defaults to 302 Found. */
  redirect(location: string, code = 302): void {
    this.#assertOpen(this.redirect);
    if (typeof location !== "string" || location.length === 0) {
      throw frameworkError(
        "res.redirect() requires a non-empty location string",
        this.redirect,
        ErrorCode.INVALID_ARGUMENT,
      );
    }
    this.statusCode = code;
    this.setHeader("Location", location);
    this.setHeader("Content-Length", 0);
    this.end();
  }

  /**
   * Mark the response as a download. With a filename, sets both the plain and
   * the RFC 5987 (`filename*`) forms, and the matching `Content-Type` when the
   * extension is known.
   */
  attachment(filename?: string): this {
    this.#assertOpen(this.attachment);
    if (filename === undefined) {
      this.setHeader("Content-Disposition", "attachment");
      return this;
    }
    if (typeof filename !== "string" || filename.length === 0) {
      throw frameworkError(
        "res.attachment() requires a non-empty filename when one is given",
        this.attachment,
        ErrorCode.INVALID_ARGUMENT,
      );
    }
    // Strip anything that could break out of the quoted string or inject a header.
    const safe = filename.replace(/[\r\n"\\]/g, "").replace(/[\u0000-\u001f\u007f]/g, "");
    const ascii = safe.replace(/[^\x20-\x7e]/g, "_");
    this.setHeader(
      "Content-Disposition",
      `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe)}`,
    );
    const type = lookupMime(safe);
    if (type !== undefined && !this.hasHeader("Content-Type")) this.setHeader("Content-Type", type);
    return this;
  }

  /**
   * Stream a file to the client with correct `Content-Type`/`Content-Length` and
   * proper backpressure.
   *
   * Relative paths resolve against `process.cwd()`. The MIME type is inferred
   * from the extension unless `mime` is given; an unknown extension with no
   * explicit type is an error rather than a silent `application/octet-stream`.
   *
   * Awaiting is recommended (`return res.sendFile(...)`) so failures land in the
   * middleware chain, but an ignored promise is safe: failures are routed to the
   * central error handler instead of becoming an unhandled rejection.
   */
  sendFile(path: string, mime?: string): Promise<void> {
    const task = this.#streamFile(path, mime);
    // Attaching this handler also marks `task` as handled, so a caller that
    // ignores the returned promise cannot produce an unhandled rejection.
    task.catch((err: unknown) => {
      // Deferred a tick: if the caller awaited, the chain has already dispatched.
      setImmediate(() => {
        if (!wasDispatched(err)) this.#sink?.(err);
      });
    });
    return task;
  }

  async #streamFile(path: string, mime?: string): Promise<void> {
    this.#assertOpen(this.sendFile);
    if (typeof path !== "string" || path.length === 0) {
      throw frameworkError(
        "res.sendFile() requires a file path",
        this.sendFile,
        ErrorCode.INVALID_ARGUMENT,
      );
    }

    let stats: Stats;
    try {
      stats = await statAsync(path);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") {
        throw frameworkError(
          `File not found: ${path}`,
          this.sendFile,
          ErrorCode.FILE_NOT_FOUND,
          404,
        );
      }
      throw err;
    }

    if (!stats.isFile()) {
      throw frameworkError(
        `Not a file: ${path}`,
        this.sendFile,
        ErrorCode.NOT_A_FILE,
        stats.isDirectory() ? 404 : 500,
      );
    }

    const type = mime ?? lookupMime(path);
    if (type === undefined) {
      throw frameworkError(
        `Unknown file extension for ${path}. Pass an explicit type: ` +
          `res.sendFile(path, "${DEFAULT_MIME}")`,
        this.sendFile,
        ErrorCode.UNKNOWN_MIME,
      );
    }

    if (stats.size <= BUFFERED_MAX_BYTES) {
      const body = await readFileAsync(path);
      // Length comes from the bytes actually read, not from the earlier stat:
      // if the file changed in between, a stale Content-Length would corrupt
      // the response framing. The streamed path cannot make this check.
      if (!this.hasHeader("Content-Type")) this.setHeader("Content-Type", type);
      this.setHeader("Content-Length", body.byteLength);
      this.end(body);
      return;
    }

    if (!this.hasHeader("Content-Type")) this.setHeader("Content-Type", type);
    this.setHeader("Content-Length", stats.size);

    // pipeline() gives backpressure, error propagation and cleanup of both ends.
    // highWaterMark is left at Node's default: 256KB was measured at -7.6% on
    // file-1mb (every paired run negative). The path is ~24% idle, so fewer,
    // larger reads buy nothing and cost more per allocation.
    await pipeline(createReadStream(path), this);
  }

  #assertOpen(fn: (...args: never[]) => unknown): void {
    if (this.headersSent) {
      throw frameworkError(
        "Cannot write to the response after the headers have been sent",
        fn,
        ErrorCode.HEADERS_SENT,
      );
    }
  }
}

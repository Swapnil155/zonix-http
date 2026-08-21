import { createReadStream, readFile as readFileCb, stat as statCb, type Stats } from "node:fs";
import { STATUS_CODES, ServerResponse } from "node:http";
import { pipeline } from "node:stream/promises";
import {
  appendValue,
  assertHeaderValue,
  contentTypeFor,
  encodeUrl,
  formatLinks,
  inferSendType,
  isBodyless,
  setCharsetUtf8,
  varyValue,
  withCharset,
} from "./compat/response.js";
import { serializeCookie, type CookieOptions } from "./cookies/serialize.js";
import { markSigned, sign } from "./cookies/sign.js";
import { ErrorCode, frameworkError, wasDispatched } from "./errors/index.js";
import { settingsOf } from "./internal/constants.js";
import { contentDisposition } from "./http/content-disposition.js";
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

/** Standard reason phrases, from node:http rather than a status-codes package. */
const STATUS_MESSAGES: Readonly<Record<number, string>> = STATUS_CODES as Record<number, string>;

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
  #locals: Record<string, unknown> | undefined = undefined;

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
      // A caller-set type is kept, but the charset is forced to utf-8 because
      // that is what was just encoded. Express does the same via send(); the
      // differential test pins it. The hot path below never reaches here — its
      // constant already carries the charset, so this costs nothing per request.
      const existing = this.getHeader("Content-Type");
      if (typeof existing === "string") {
        this.setHeader("Content-Type", setCharsetUtf8(existing));
      }
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

  /**
   * Send a `Location` redirect. Defaults to 302 Found.
   *
   * The location is URL-encoded, so a newline in a user-supplied redirect
   * target becomes `%0A` rather than splitting the response.
   *
   * Two argument orders are accepted. `redirect(url, code)` is the zonix
   * signature; `redirect(code, url)` is Express's documented overload, which
   * exists because handlers are copy-pasted out of its docs in that form. The
   * Phase 6 exit test caught its absence — the surface is only compatible if
   * the shapes people actually write are the shapes it accepts.
   */
  redirect(location: string, code?: number): void;
  redirect(code: number, location: string): void;
  redirect(a: string | number, b?: string | number): void {
    this.#assertOpen(this.redirect);
    const location = typeof a === "number" ? (b as string) : a;
    const code = typeof a === "number" ? a : ((b as number | undefined) ?? 302);
    if (typeof location !== "string") {
      throw frameworkError(
        "res.redirect() requires a URL: redirect(url), redirect(url, code) or redirect(code, url)",
        this.redirect,
        ErrorCode.INVALID_ARGUMENT,
      );
    }
    this.location(location);
    this.statusCode = code;
    this.setHeader("Content-Length", 0);
    this.end();
  }

  // --- Express compat surface ------------------------------------------------

  /**
   * Set a response header, or several at once with an object.
   *
   * A `Content-Type` without a charset gains `; charset=utf-8` where that is
   * correct, matching Express.
   */
  set(
    field: string | Readonly<Record<string, string | readonly string[]>>,
    value?: string | readonly string[],
  ): this {
    if (typeof field === "object") {
      for (const [key, val] of Object.entries(field)) this.set(key, val);
      return this;
    }
    if (typeof field !== "string" || field.length === 0) {
      throw frameworkError(
        "res.set() requires a header name",
        this.set,
        ErrorCode.INVALID_ARGUMENT,
      );
    }

    if (Array.isArray(value)) {
      const values = value.map(String);
      for (const item of values) assertHeaderValue(field, item, this.set);
      this.setHeader(field, values);
      return this;
    }

    let out = String(value);
    assertHeaderValue(field, out, this.set);
    if (field.toLowerCase() === "content-type") out = withCharset(out);
    this.setHeader(field, out);
    return this;
  }

  /** Alias of `set()`. */
  header(
    field: string | Readonly<Record<string, string | readonly string[]>>,
    value?: string | readonly string[],
  ): this {
    return this.set(field, value);
  }

  /** Read a header already set on this response. */
  get(field: string): string | number | string[] | undefined {
    return this.getHeader(field);
  }

  /** Append to a header, keeping any existing value. */
  append(field: string, value: string | readonly string[]): this {
    const merged = appendValue(this.getHeader(field), value);
    return this.set(field, merged);
  }

  /**
   * Set `Content-Type` from a full type, an extension, or a filename.
   *
   * An unknown extension throws rather than writing the string `"false"` into
   * the header, which is what Express does.
   */
  type(value: string): this {
    this.setHeader("Content-Type", contentTypeFor(value, this.type));
    return this;
  }

  /** Alias of `type()`. */
  contentType(value: string): this {
    return this.type(value);
  }

  /** Add fields to `Vary`, deduplicated; `*` absorbs everything. */
  vary(field: string | readonly string[]): this {
    const fields = Array.isArray(field) ? field : [field as string];
    this.setHeader("Vary", varyValue(this.getHeader("Vary"), fields));
    return this;
  }

  /** Add `Link` relations. */
  links(links: Readonly<Record<string, string>>): this {
    const value = formatLinks(this.getHeader("Link"), links);
    assertHeaderValue("Link", value, this.links);
    this.setHeader("Link", value);
    return this;
  }

  /**
   * Set `Location`, URL-encoding it.
   *
   * `"back"` resolves to the `Referer` header, or `/` when there is none.
   */
  location(url: string): this {
    if (typeof url !== "string" || url.length === 0) {
      throw frameworkError(
        "res.location() requires a non-empty URL",
        this.location,
        ErrorCode.INVALID_ARGUMENT,
      );
    }
    let target = url;
    if (target === "back") {
      const referrer = this.req.get("referrer");
      target = typeof referrer === "string" && referrer.length > 0 ? referrer : "/";
    }
    this.setHeader("Location", encodeUrl(target));
    return this;
  }

  /**
   * Per-response data, for middleware to pass values to a handler or view.
   *
   * Created on first touch (performance rule 1) and null-prototype, so a key
   * like `__proto__` is inert.
   */
  get locals(): Record<string, unknown> {
    return (this.#locals ??= Object.create(null) as Record<string, unknown>);
  }

  set locals(value: Record<string, unknown>) {
    this.#locals = value;
  }

  /** Send the status code with its standard message as the body. */
  sendStatus(code: number): void {
    this.status(code);
    this.setHeader("Content-Type", "text/plain; charset=utf-8");
    this.send(STATUS_MESSAGES[code] ?? String(code));
  }

  /**
   * Send a body, inferring `Content-Type` (decision 13).
   *
   * A number throws: `res.send(404)` reads like a status but Express sends the
   * body `404`. The error points at `sendStatus`.
   */
  send(body?: unknown): void {
    this.#assertOpen(this.send);
    if (body === undefined) {
      this.#finish(undefined);
      return;
    }

    const plan = inferSendType(body, this.hasHeader("Content-Type"), this.send);
    if (plan.kind === "json") {
      this.json(plan.value);
      return;
    }
    if (plan.type !== undefined) {
      this.setHeader("Content-Type", plan.type);
    } else if (plan.kind === "string") {
      // A string is written as utf-8, so the declared type says utf-8 —
      // whatever that type is. Express applies this to every type, including
      // ones where it reads oddly (`image/png; charset=utf-8`); matching it is
      // the point of a compat surface. Buffers keep the type untouched.
      const existing = this.getHeader("Content-Type");
      if (typeof existing === "string") {
        this.setHeader("Content-Type", setCharsetUtf8(existing));
      }
    }
    this.#finish(plan.kind === "buffer" ? plan.value : Buffer.from(plan.value, "utf8"));
  }

  /** Set a cookie. Signing requires `cookieSecret` on the app. */
  cookie(name: string, value: unknown, options: CookieOptions = {}): this {
    const opts: CookieOptions = { ...options };

    // Objects travel as Express's "j:" JSON form so cookieParser can revive them.
    let raw =
      typeof value === "object" && value !== null ? `j:${JSON.stringify(value)}` : String(value);

    if (opts.signed === true) {
      const secret = settingsOf(this.req.socket).cookieSecret;
      if (secret === undefined || secret.length === 0) {
        throw frameworkError(
          'Signed cookies need a secret: zonix({ cookieSecret: "..." })',
          this.cookie,
          ErrorCode.INVALID_ARGUMENT,
        );
      }
      raw = markSigned(sign(raw, secret));
    }
    delete opts.signed;

    // maxAge is milliseconds in the API and seconds on the wire; it also sets
    // Expires so that clients without Max-Age support still expire the cookie.
    if (opts.maxAge !== undefined && opts.maxAge !== null && Number.isFinite(opts.maxAge)) {
      const ms = opts.maxAge;
      opts.expires = new Date(Date.now() + ms);
      opts.maxAge = Math.floor(ms / 1000);
    }
    if (opts.path === undefined) opts.path = "/";

    this.append("Set-Cookie", serializeCookie(name, raw, opts));
    return this;
  }

  /**
   * Expire a cookie.
   *
   * `path` and `domain` must match the cookie that was set, or the browser
   * stores a second cookie and keeps the original. The expiry is applied
   * **after** the caller's options, so — unlike Express 4 — passing `maxAge`
   * cannot accidentally turn a clear into a renewal.
   */
  clearCookie(name: string, options: CookieOptions = {}): this {
    const opts: CookieOptions = { path: "/", ...options };
    delete opts.maxAge;
    opts.expires = new Date(1);
    return this.cookie(name, "", opts);
  }

  /** Shared tail for `send`: sets Content-Length and strips bodyless headers. */
  #finish(body: Buffer | undefined): void {
    if (isBodyless(this.statusCode)) {
      this.removeHeader("Content-Type");
      this.removeHeader("Content-Length");
      this.removeHeader("Transfer-Encoding");
      this.end();
      return;
    }
    if (body === undefined) {
      this.end();
      return;
    }
    this.setHeader("Content-Length", body.byteLength);
    // Node drops the body for HEAD itself, but ending explicitly keeps the
    // wire output identical either way.
    if (this.req.method === "HEAD") this.end();
    else this.end(body);
  }

  /**
   * Mark the response as a download.
   *
   * The header is built by `http/content-disposition.ts`, which follows RFC
   * 6266/5987 and is pinned to the real `content-disposition` package by a
   * differential test. The earlier hand-rolled version here was wrong in ways
   * that mattered: it emitted `filename*` even for plain ASCII names, deleted
   * quotes instead of escaping them, and left the path in the header.
   *
   * With a filename, `Content-Type` is also set from its extension when the
   * extension is known — as Express does.
   */
  attachment(filename?: string): this {
    this.#assertOpen(this.attachment);
    if (filename !== undefined && typeof filename !== "string") {
      throw frameworkError(
        "res.attachment() requires a filename string",
        this.attachment,
        ErrorCode.INVALID_ARGUMENT,
      );
    }

    // An empty string is treated as "no filename", matching Express's truthiness check.
    const name = filename === undefined || filename.length === 0 ? undefined : filename;
    this.setHeader("Content-Disposition", contentDisposition(name));

    if (name !== undefined) {
      const type = lookupMime(name);
      // Express sets the type unconditionally here and ends up writing the
      // string "false" when the extension is unknown; we simply leave the
      // header alone in that case. Recorded in the compat table.
      if (type !== undefined) this.setHeader("Content-Type", type);
    }
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

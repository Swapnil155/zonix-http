import http from "node:http";
import type { AddressInfo, ListenOptions } from "node:net";
import { ErrorCode, frameworkError, isClientDisconnect, markDispatched, toError } from "./errors.js";
import { ZonixRequest } from "./request.js";
import { ZonixResponse } from "./response.js";
import { Router } from "./router.js";
import type {
  ErrorHandler,
  Handler,
  HttpMethod,
  Middleware,
  Next,
  ZonixError,
  ZonixOptions,
} from "./types.js";

const METHODS: readonly HttpMethod[] = ["get", "post", "put", "patch", "delete", "head", "options"];

/**
 * Run a chain of middleware to completion.
 *
 * Resolves when the chain is exhausted, rejects with the first error surfaced by
 * `next(err)`, a synchronous throw, or a rejected promise. Never advances on its
 * own: like Express, a middleware that neither responds nor calls `next()` parks
 * the request.
 */
function runChain(
  chain: readonly Middleware[],
  req: ZonixRequest,
  res: ZonixResponse,
  dev: boolean,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const step = (index: number): void => {
      const mw = chain[index];
      if (mw === undefined) {
        resolve();
        return;
      }

      let advanced = false;
      const next: Next = (err) => {
        if (advanced) {
          if (dev) {
            console.warn(
              `zonix: next() called more than once by middleware #${index} for ` +
                `${req.method} ${req.url} - the extra call was ignored`,
            );
          }
          return;
        }
        advanced = true;
        if (err !== undefined && err !== null) {
          reject(err);
          return;
        }
        step(index + 1);
      };

      let result: unknown;
      try {
        result = mw(req, res, next);
      } catch (err) {
        reject(err);
        return;
      }
      // A rejection is an error; resolving does NOT advance the chain.
      if (isThenable(result)) result.then(undefined, reject);
    };

    step(0);
  });
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    typeof (value as PromiseLike<unknown>).then === "function"
  );
}

/** The application. Create one with the default export: `const app = zonix()`. */
export class Zonix {
  /** Escape hatch to the underlying `http.Server`. */
  readonly server: http.Server<typeof ZonixRequest, typeof ZonixResponse>;

  readonly #globals: Middleware[] = [];
  readonly #router = new Router();
  readonly #dev: boolean;
  #errHandler: ErrorHandler | undefined = undefined;
  #fallback: Handler | undefined = undefined;

  constructor(options: ZonixOptions = {}) {
    this.#dev = options.dev ?? process.env["NODE_ENV"] !== "production";
    this.server = http.createServer(
      { IncomingMessage: ZonixRequest, ServerResponse: ZonixResponse },
      (req, res) => {
        // Errors raised outside the chain (an ignored sendFile promise, a socket
        // failure mid-stream) still land in the one dispatcher.
        ZonixResponse.attachErrorSink(res, (err: unknown) => {
          void this.#dispatchError(err, req, res);
        });
        this.#handle(req, res).catch((err: unknown) => {
          // #handle is written not to reject; this only fires if zonix itself broke.
          console.error("zonix: internal failure while handling a request", err);
        });
      },
    );
  }

  /** Register global middleware. Runs in registration order for every request. */
  use(...middleware: Middleware[]): this {
    if (middleware.length === 0) {
      throw frameworkError(
        "app.use() requires at least one middleware",
        this.use,
        ErrorCode.INVALID_ARGUMENT,
      );
    }
    for (const mw of middleware) {
      if (typeof mw !== "function") {
        throw frameworkError(
          `app.use() expects functions, received ${typeof mw}`,
          this.use,
          ErrorCode.INVALID_ARGUMENT,
        );
      }
      this.#globals.push(mw);
    }
    return this;
  }

  /** Register a route. Middleware passed before the handler runs only for this route. */
  route(method: string, path: string, ...rest: [...Middleware[], Handler]): this {
    if (typeof method !== "string" || method.length === 0) {
      throw frameworkError(
        "app.route() requires an HTTP method string",
        this.route,
        ErrorCode.INVALID_ARGUMENT,
      );
    }
    if (typeof path !== "string" || !path.startsWith("/")) {
      throw frameworkError(
        `Route path must start with "/", received ${JSON.stringify(path)}`,
        this.route,
        ErrorCode.INVALID_ROUTE,
      );
    }
    const handler = rest[rest.length - 1];
    if (typeof handler !== "function") {
      throw frameworkError(
        `app.route("${method}", "${path}") needs a handler function as its last argument`,
        this.route,
        ErrorCode.INVALID_ARGUMENT,
      );
    }
    const middleware = rest.slice(0, -1) as Middleware[];
    for (const mw of middleware) {
      if (typeof mw !== "function") {
        throw frameworkError(
          `Route middleware must be functions, received ${typeof mw}`,
          this.route,
          ErrorCode.INVALID_ARGUMENT,
        );
      }
    }
    this.#router.add(method, path, middleware, handler as Handler);
    return this;
  }

  /** Register the central error handler. Only one may be registered. */
  handleErr(handler: ErrorHandler): this {
    if (typeof handler !== "function") {
      throw frameworkError(
        "app.handleErr() requires a function",
        this.handleErr,
        ErrorCode.INVALID_ARGUMENT,
      );
    }
    if (this.#errHandler !== undefined) {
      throw frameworkError(
        "An error handler is already registered; only one is allowed",
        this.handleErr,
        ErrorCode.ALREADY_REGISTERED,
      );
    }
    this.#errHandler = handler;
    return this;
  }

  /** Replace the default 404 responder. Only one may be registered. */
  fallback(handler: Handler): this {
    if (typeof handler !== "function") {
      throw frameworkError(
        "app.fallback() requires a function",
        this.fallback,
        ErrorCode.INVALID_ARGUMENT,
      );
    }
    if (this.#fallback !== undefined) {
      throw frameworkError(
        "A fallback handler is already registered; only one is allowed",
        this.fallback,
        ErrorCode.ALREADY_REGISTERED,
      );
    }
    this.#fallback = handler;
    return this;
  }

  listen(port?: number, hostname?: string, callback?: () => void): http.Server;
  listen(port: number, callback?: () => void): http.Server;
  listen(options: ListenOptions, callback?: () => void): http.Server;
  listen(...args: unknown[]): http.Server {
    const listen = this.server.listen as (...a: unknown[]) => http.Server;
    return listen.apply(this.server, args);
  }

  /** Bound address, or `null` when the server is not listening. */
  address(): AddressInfo | string | null {
    return this.server.address();
  }

  /** Stop accepting new connections. */
  close(callback?: (err?: Error) => void): this {
    this.server.close(callback);
    return this;
  }

  async #handle(req: ZonixRequest, res: ZonixResponse): Promise<void> {
    try {
      const match = this.#router.find(req.method ?? "get", req.path);
      const chain: Middleware[] = [...this.#globals];

      if (match !== undefined) {
        req.params = match.params;
        chain.push(...match.middleware, match.handler);
      } else if (this.#fallback !== undefined) {
        chain.push(this.#fallback);
      } else {
        chain.push((r, s) => {
          this.#notFound(r, s);
        });
      }

      await runChain(chain, req, res, this.#dev);
    } catch (err) {
      await this.#dispatchError(err, req, res);
    }
  }

  #notFound(req: ZonixRequest, res: ZonixResponse): void {
    res.status(404).json({ error: `Cannot ${(req.method ?? "GET").toUpperCase()} ${req.path}` });
  }

  /**
   * Single funnel for everything that goes wrong. Never rejects: a failure in
   * here is logged and swallowed rather than escaping as an unhandled rejection.
   */
  async #dispatchError(thrown: unknown, req: ZonixRequest, res: ZonixResponse): Promise<void> {
    markDispatched(thrown);
    const err = toError(thrown);
    markDispatched(err);
    // Decision 6 plus one extension: an aborted write surfaces as
    // ERR_STREAM_DESTROYED rather than one of the socket codes, so a request
    // whose peer has verifiably gone counts as a disconnect regardless of code.
    if (isClientDisconnect(err) || (req.destroyed && !res.writableFinished)) {
      err.clientDisconnect = true;
    }

    // Past the point of a clean response: kill the socket, then still let the app
    // observe the error for logging, with any write attempt swallowed.
    if (res.headersSent || res.writableEnded) {
      try {
        req.socket?.destroy();
      } catch {
        /* socket already gone */
      }
      await this.#notifyQuietly(err, req, res);
      return;
    }

    if (this.#errHandler === undefined) {
      this.#defaultErrorResponse(err, res);
      return;
    }

    try {
      if (this.#writable(res)) res.setHeader("Connection", "close");
      await this.#errHandler(err, req, res);
      // A handler that observed the error without answering still owes a response.
      if (!res.headersSent && !res.writableEnded && this.#writable(res)) {
        this.#defaultErrorResponse(err, res);
      }
    } catch (secondary) {
      console.error("zonix: the registered error handler threw while handling:", err);
      console.error("zonix: error handler failure:", secondary);
      this.#bare500(res);
    }
  }

  async #notifyQuietly(err: ZonixError, req: ZonixRequest, res: ZonixResponse): Promise<void> {
    if (this.#errHandler === undefined) {
      if (!err.clientDisconnect) console.error("zonix: error after headers were sent:", err);
      return;
    }
    try {
      await this.#errHandler(err, req, res);
    } catch {
      /* the response is already unusable; nothing left to report to the client */
    }
  }

  #defaultErrorResponse(err: ZonixError, res: ZonixResponse): void {
    const status =
      typeof err.status === "number" && err.status >= 400 && err.status <= 599 ? err.status : 500;
    // Client errors may state their reason; server errors never leak internals.
    const message = status < 500 ? err.message : "Internal Server Error";
    try {
      res.status(status).json({ error: message });
    } catch {
      this.#bare500(res);
    }
  }

  #bare500(res: ZonixResponse): void {
    try {
      if (res.headersSent || res.writableEnded || !this.#writable(res)) {
        res.socket?.destroy();
        return;
      }
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ error: "Internal Server Error" }));
    } catch {
      try {
        res.socket?.destroy();
      } catch {
        /* nothing further to do */
      }
    }
  }

  #writable(res: ZonixResponse): boolean {
    return res.socket !== null && !res.socket.destroyed;
  }

  // --- method sugar: app.get/post/put/patch/delete/head/options -------------
  declare get: (path: string, ...rest: [...Middleware[], Handler]) => this;
  declare post: (path: string, ...rest: [...Middleware[], Handler]) => this;
  declare put: (path: string, ...rest: [...Middleware[], Handler]) => this;
  declare patch: (path: string, ...rest: [...Middleware[], Handler]) => this;
  declare delete: (path: string, ...rest: [...Middleware[], Handler]) => this;
  declare head: (path: string, ...rest: [...Middleware[], Handler]) => this;
  declare options: (path: string, ...rest: [...Middleware[], Handler]) => this;
}

for (const method of METHODS) {
  Object.defineProperty(Zonix.prototype, method, {
    value: function (this: Zonix, path: string, ...rest: [...Middleware[], Handler]) {
      return this.route(method, path, ...rest);
    },
    writable: true,
    enumerable: false,
    configurable: true,
  });
}

/** Create an application. */
export default function zonix(options?: ZonixOptions): Zonix {
  return new Zonix(options);
}

export { ZonixRequest } from "./request.js";
export { ZonixResponse } from "./response.js";
export { ErrorCode, frameworkError, isClientDisconnect } from "./errors.js";
export type {
  ErrorHandler,
  Handler,
  HandlerResult,
  HttpMethod,
  Middleware,
  Next,
  StringMap,
  ZonixError,
  ZonixOptions,
} from "./types.js";

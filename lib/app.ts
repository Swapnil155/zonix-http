import http from "node:http";
import type { AddressInfo, ListenOptions } from "node:net";
import { ErrorCode, frameworkError } from "./errors/index.js";
import { compileTrust } from "./http/proxy.js";
import { kSettings } from "./internal/constants.js";
import { dispatchError } from "./internal/dispatch-error.js";
import { isThenable, runChain } from "./internal/run-chain.js";
import { ZonixRequest } from "./request.js";
import { ZonixResponse } from "./response.js";
import { Router, type Route, type RouteMatch } from "./router/index.js";
import type {
  ErrorHandler,
  Handler,
  HttpMethod,
  Middleware,
  ZonixOptions,
  ZonixSettings,
} from "./types.js";

const METHODS: readonly HttpMethod[] = ["get", "post", "put", "patch", "delete", "head", "options"];

/** The application. Create one with the default export: `const app = zonix()`. */
export class Zonix {
  /** Escape hatch to the underlying `http.Server`. */
  readonly server: http.Server<typeof ZonixRequest, typeof ZonixResponse>;

  readonly #globals: Middleware[] = [];
  /** Bumped whenever the global chain or the fallback changes, invalidating cached pipelines. */
  #globalsVersion = 0;
  #missPipeline: Middleware[] | undefined = undefined;
  #missPipelineVersion = -1;
  readonly #router = new Router();
  readonly #dev: boolean;
  #errHandler: ErrorHandler | undefined = undefined;
  #fallback: Handler | undefined = undefined;

  constructor(options: ZonixOptions = {}) {
    this.#dev = options.dev ?? process.env["NODE_ENV"] !== "production";
    // Compiled once here, read by request accessors through `req.socket.server`.
    // Nothing is attached per request, so a request that never asks for req.ip
    // pays nothing for the setting existing.
    const settings: ZonixSettings = {
      trust: compileTrust(options.trustProxy),
      subdomainOffset: options.subdomainOffset ?? 2,
      cookieSecret: options.cookieSecret,
    };
    this.server = http.createServer(
      { IncomingMessage: ZonixRequest, ServerResponse: ZonixResponse },
      (req, res) => {
        // Errors raised outside the chain (an ignored sendFile promise, a socket
        // failure mid-stream) still land in the one dispatcher.
        ZonixRequest.attachResponse(req, res);
        ZonixResponse.attachErrorSink(res, (err: unknown) => {
          this.#fail(err, req, res);
        });
        this.#handle(req, res);
      },
    );
    (this.server as unknown as Record<symbol, ZonixSettings>)[kSettings] = settings;
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
    this.#globalsVersion++;
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
    this.#globalsVersion++;
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

  #handle(req: ZonixRequest, res: ZonixResponse): void {
    let match;
    try {
      match = this.#router.find(req.method ?? "GET", req.path);
    } catch (err) {
      this.#fail(err, req, res);
      return;
    }

    // Fast path: a matched route with nothing to run but its own handler. Skips
    // the chain array, the chain promise and the per-step closures entirely.
    if (match !== undefined && this.#globals.length === 0 && match.route.middleware.length === 0) {
      req.params = match.params;
      try {
        const result = match.route.handler(req, res, (err) => {
          // A lone handler calling next() has nowhere to advance to, but
          // next(err) must still reach dispatch exactly as it would in a chain.
          if (err !== undefined && err !== null) this.#fail(err, req, res);
        });
        if (isThenable(result)) result.then(undefined, (err: unknown) => this.#fail(err, req, res));
      } catch (err) {
        this.#fail(err, req, res);
      }
      return;
    }

    this.#runChain(match, req, res);
  }

  #runChain(match: RouteMatch | undefined, req: ZonixRequest, res: ZonixResponse): void {
    try {
      let chain: Middleware[];
      if (match !== undefined) {
        req.params = match.params;
        chain = this.#pipelineFor(match.route);
      } else {
        chain = this.#pipelineForMiss();
      }

      runChain(chain, req, res, this.#dev, (err) => this.#fail(err, req, res));
    } catch (err) {
      this.#fail(err, req, res);
    }
  }

  /**
   * The flattened global + route middleware + handler array for a route, built
   * once and reused. Rebuilt only if `use()` or `fallback()` ran since, so
   * registering middleware after the server is serving stays correct.
   */
  #pipelineFor(route: Route): Middleware[] {
    const cached = route.pipeline;
    if (cached !== undefined && route.pipelineVersion === this.#globalsVersion) return cached;

    const chain: Middleware[] = [...this.#globals, ...route.middleware, route.handler];
    route.pipeline = chain;
    route.pipelineVersion = this.#globalsVersion;
    return chain;
  }

  /** Same, for requests that matched no route. */
  #pipelineForMiss(): Middleware[] {
    const cached = this.#missPipeline;
    if (cached !== undefined && this.#missPipelineVersion === this.#globalsVersion) return cached;

    const terminal: Middleware =
      this.#fallback ??
      ((r, s) => {
        this.#notFound(r, s);
      });
    const chain: Middleware[] = [...this.#globals, terminal];
    this.#missPipeline = chain;
    this.#missPipelineVersion = this.#globalsVersion;
    return chain;
  }

  /** Hand an error to central dispatch from a non-async context. */
  #fail(err: unknown, req: ZonixRequest, res: ZonixResponse): void {
    dispatchError(err, req, res, this.#errHandler).catch((internal: unknown) => {
      // dispatchError is written not to reject; this only fires if zonix broke.
      console.error("zonix: internal failure while dispatching an error", internal);
    });
  }

  #notFound(req: ZonixRequest, res: ZonixResponse): void {
    res.status(404).json({ error: `Cannot ${(req.method ?? "GET").toUpperCase()} ${req.path}` });
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

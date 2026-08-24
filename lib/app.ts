import http from "node:http";
import type { AddressInfo, ListenOptions } from "node:net";
import { ErrorCode, frameworkError } from "./errors/index.js";
import { compileTrust } from "./http/proxy.js";
import { DEFAULT_MAX_PARAM_LENGTH, kSettings } from "./internal/constants.js";
import { dispatchError } from "./internal/dispatch-error.js";
import { isThenable, runChain } from "./internal/run-chain.js";
import { ZonixRequest } from "./request.js";
import { compileEtag } from "./http/etag.js";
import { ZonixResponse } from "./response.js";
import { RouteTable, type Route, type RouteMatch } from "./router/index.js";
import {
  MountableRouter,
  Router,
  isErrorMiddleware,
  mountLayer,
  parseUse,
  registerRoute,
  runErrorLayers,
  scopeErrorLayer,
} from "./router/mount.js";
import type {
  ErrorHandler,
  ErrorMiddleware,
  Handler,
  HttpMethod,
  Middleware,
  ZonixOptions,
  ZonixSettings,
} from "./types.js";

const METHODS: readonly HttpMethod[] = ["get", "post", "put", "patch", "delete", "head", "options"];

/**
 * Set one of the server's slow-client timeouts (ZH-004). Uses the caller's value
 * when given (validated non-negative; 0 disables), otherwise the safe default.
 */
function applyTimeout(
  server: Record<"headersTimeout" | "requestTimeout" | "keepAliveTimeout", number>,
  field: "headersTimeout" | "requestTimeout" | "keepAliveTimeout",
  value: number | undefined,
  fallback: number,
): void {
  if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
    throw frameworkError(
      `${field} must be a non-negative number of milliseconds, received ${String(value)}`,
      zonix,
      ErrorCode.INVALID_ARGUMENT,
    );
  }
  server[field] = value ?? fallback;
}

/** The application. Create one with the default export: `const app = zonix()`. */
export class Zonix {
  /** Escape hatch to the underlying `http.Server`. */
  readonly server: http.Server<typeof ZonixRequest, typeof ZonixResponse>;

  /** Plain global middleware, in order - the hot path's chain prefix. */
  readonly #globals: Middleware[] = [];
  /**
   * Every `use()` entry in registration order, prefixed ones wrapped. Used as
   * the chain prefix instead of `#globals` once anything is mounted, so the
   * Express ordering between plain and mounted middleware is preserved.
   */
  readonly #stack: Middleware[] = [];
  #mounted = false;
  /** Four-arity error middleware, run before `handleErr`. */
  readonly #errors: ErrorMiddleware[] = [];
  /** Bumped whenever the global chain or the fallback changes, invalidating cached pipelines. */
  #globalsVersion = 0;
  #missPipeline: Middleware[] | undefined = undefined;
  #missPipelineVersion = -1;
  readonly #router = new RouteTable();
  readonly #dev: boolean;
  readonly #maxParamLength: number;
  /** Compiled settings shared with every request (mutated in place by `set()`). */
  readonly #settings: ZonixSettings;
  /** Every `app.set()` value as given, for `app.get(name)`/`enabled()`. */
  readonly #store = new Map<string, unknown>();
  #errHandler: ErrorHandler | undefined = undefined;
  #fallback: Handler | undefined = undefined;

  constructor(options: ZonixOptions = {}) {
    this.#dev = options.dev ?? process.env["NODE_ENV"] !== "production";
    // Compiled once here, read by request accessors through `req.socket.server`.
    // Nothing is attached per request, so a request that never asks for req.ip
    // pays nothing for the setting existing.
    const maxParamLength = options.maxParamLength ?? DEFAULT_MAX_PARAM_LENGTH;
    if (typeof maxParamLength !== "number" || Number.isNaN(maxParamLength) || maxParamLength < 0) {
      throw frameworkError(
        `maxParamLength must be a non-negative number, received ${String(maxParamLength)}`,
        zonix,
        ErrorCode.INVALID_ARGUMENT,
      );
    }
    this.#maxParamLength = maxParamLength;
    const settings: ZonixSettings = {
      trust: compileTrust(options.trustProxy),
      subdomainOffset: options.subdomainOffset ?? 2,
      cookieSecret: options.cookieSecret,
      etag: compileEtag(options.etag),
      maxParamLength,
      dev: this.#dev,
      queryParser: options.queryParser ?? "simple",
    };
    if (settings.queryParser !== "simple" && settings.queryParser !== "extended") {
      throw frameworkError(
        `queryParser must be "simple" or "extended", received ${String(settings.queryParser)}`,
        zonix,
        ErrorCode.INVALID_ARGUMENT,
      );
    }
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
    // Slowloris / slow-client hardening (ZH-004). Pin safe timeouts regardless of
    // the Node version's own defaults; each is overridable, 0 disables.
    applyTimeout(this.server, "headersTimeout", options.headersTimeout, 60_000);
    applyTimeout(this.server, "requestTimeout", options.requestTimeout, 300_000);
    applyTimeout(this.server, "keepAliveTimeout", options.keepAliveTimeout, 5_000);
    this.#settings = settings;
    this.#store.set("trust proxy", options.trustProxy ?? false);
    this.#store.set("etag", options.etag ?? false);
    this.#store.set("query parser", settings.queryParser);
    this.#store.set("subdomain offset", settings.subdomainOffset);
    this.#store.set("x-powered-by", false);
  }

  /**
   * Express's settings API. Four names change behaviour - `trust proxy`,
   * `etag`, `query parser`, `subdomain offset` (the same knobs as the
   * constructor options) - and every other name is stored as given so an
   * app can keep its own (`app.set("views", ...)`). `x-powered-by` is
   * accepted and ignored: zonix never sends that header.
   */
  set(name: string, value: unknown): this {
    if (typeof name !== "string") {
      throw frameworkError(
        "app.set() requires a setting name",
        this.set,
        ErrorCode.INVALID_ARGUMENT,
      );
    }
    switch (name) {
      case "trust proxy":
        this.#settings.trust = compileTrust(value as ZonixOptions["trustProxy"]);
        break;
      case "etag":
        this.#settings.etag = compileEtag(value as ZonixOptions["etag"]);
        break;
      case "query parser":
        if (value !== "simple" && value !== "extended") {
          throw frameworkError(
            `query parser must be "simple" or "extended", received ${String(value)}`,
            this.set,
            ErrorCode.INVALID_ARGUMENT,
          );
        }
        this.#settings.queryParser = value;
        break;
      case "subdomain offset":
        this.#settings.subdomainOffset = Number(value);
        break;
      default:
        break;
    }
    this.#store.set(name, value);
    return this;
  }

  /** @internal */
  static readSetting(app: Zonix, name: string): unknown {
    return app.#store.get(name);
  }

  /** `app.set(name, true)`. */
  enable(name: string): this {
    return this.set(name, true);
  }

  /** `app.set(name, false)`. */
  disable(name: string): this {
    return this.set(name, false);
  }

  /** Is the setting truthy? */
  enabled(name: string): boolean {
    return Boolean(this.#store.get(name));
  }

  /** Is the setting falsy? */
  disabled(name: string): boolean {
    return !this.#store.get(name);
  }

  /**
   * Register middleware: `use(fn)`, `use(path, fn)`, `use(path, router)`, or
   * four-arity `use((err, req, res, next) => ...)` error middleware.
   *
   * Everything registered here runs before any route, in registration order
   * (a deliberate, documented difference from Express, where a `use()` after
   * a route does not apply to it). A mount path is a static segment-aligned
   * prefix; under it `req.url`/`req.path` lose the prefix and `req.baseUrl`
   * gains it, restored when the layer calls `next()`. Error middleware runs
   * before `handleErr`.
   */
  use(...middleware: Middleware[]): this;
  use(path: string, ...middleware: Middleware[]): this;
  use(...middleware: ErrorMiddleware[]): this;
  use(path: string, ...middleware: ErrorMiddleware[]): this;
  use(...routers: MountableRouter[]): this;
  use(path: string, ...routers: MountableRouter[]): this;
  use(...args: unknown[]): this {
    const { prefix, fns } = parseUse(args, this.use, "app.use()");
    for (const fn of fns) {
      if (fn instanceof MountableRouter) {
        this.#mount(mountLayer(prefix, fn.handle));
      } else if (isErrorMiddleware(fn)) {
        this.#errors.push(scopeErrorLayer(prefix, fn));
      } else if (prefix.length === 0) {
        this.#globals.push(fn as Middleware);
        this.#stack.push(fn as Middleware);
      } else {
        this.#mount(mountLayer(prefix, fn as Middleware));
      }
    }
    this.#globalsVersion++;
    return this;
  }

  #mount(layer: Middleware): void {
    this.#mounted = true;
    this.#stack.push(layer);
  }

  /** Register a route. Middleware passed before the handler runs only for this route. */
  route(method: string, path: string, ...rest: [...Middleware[], Handler]): this {
    registerRoute(this.#router, method, path, rest, this.route, "app.route()");
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
      match = this.#router.find(req.method ?? "GET", req.path, this.#maxParamLength);
    } catch (err) {
      this.#fail(err, req, res);
      return;
    }

    // Fast path: a matched route with nothing to run but its own handler. Skips
    // the chain array, the chain promise and the per-step closures entirely.
    if (
      match !== undefined &&
      this.#globals.length === 0 &&
      !this.#mounted &&
      match.route.middleware.length === 0
    ) {
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

    const base = this.#mounted ? this.#stack : this.#globals;
    const chain: Middleware[] = [...base, ...route.middleware, route.handler];
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
    const base = this.#mounted ? this.#stack : this.#globals;
    const chain: Middleware[] = [...base, terminal];
    this.#missPipeline = chain;
    this.#missPipelineVersion = this.#globalsVersion;
    return chain;
  }

  /** Hand an error to central dispatch from a non-async context. */
  #fail(err: unknown, req: ZonixRequest, res: ZonixResponse): void {
    if (this.#errors.length !== 0) {
      runErrorLayers(this.#errors, err, req, res, (remaining) =>
        this.#dispatch(remaining, req, res),
      );
      return;
    }
    this.#dispatch(err, req, res);
  }

  #dispatch(err: unknown, req: ZonixRequest, res: ZonixResponse): void {
    dispatchError(err, req, res, this.#errHandler).catch((internal: unknown) => {
      // dispatchError is written not to reject; this only fires if zonix broke.
      console.error("zonix: internal failure while dispatching an error", internal);
    });
  }

  #notFound(req: ZonixRequest, res: ZonixResponse): void {
    res.status(404).json({ error: `Cannot ${(req.method ?? "GET").toUpperCase()} ${req.path}` });
  }

  // --- method sugar: app.get/post/put/patch/delete/head/options -------------
  /** `app.get(path, ...handlers)` registers a route; `app.get(name)` reads a setting, as in Express. */
  declare get: {
    (path: string, ...rest: [...Middleware[], Handler]): Zonix;
    (setting: string): unknown;
  };
  declare post: (path: string, ...rest: [...Middleware[], Handler]) => this;
  declare put: (path: string, ...rest: [...Middleware[], Handler]) => this;
  declare patch: (path: string, ...rest: [...Middleware[], Handler]) => this;
  declare delete: (path: string, ...rest: [...Middleware[], Handler]) => this;
  declare head: (path: string, ...rest: [...Middleware[], Handler]) => this;
  /** Register `path` for every HTTP method at once (Express's `app.all`). */
  all(path: string, ...rest: [...Middleware[], Handler]): this {
    for (const method of METHODS) this.route(method, path, ...rest);
    return this;
  }

  declare options: (path: string, ...rest: [...Middleware[], Handler]) => this;
}

for (const method of METHODS) {
  Object.defineProperty(Zonix.prototype, method, {
    value: function (this: Zonix, path: string, ...rest: [...Middleware[], Handler]) {
      // Express overload: a lone string argument to `get` reads a setting.
      if (method === "get" && rest.length === 0) return Zonix.readSetting(this, path);
      return this.route(method, path, ...rest);
    },
    writable: true,
    enumerable: false,
    configurable: true,
  });
}

/** Create an application. `zonix.Router()` creates a mountable router. */
export default function zonix(options?: ZonixOptions): Zonix {
  return new Zonix(options);
}
zonix.Router = Router;

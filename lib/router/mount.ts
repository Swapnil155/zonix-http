import { ErrorCode, frameworkError, toError } from "../errors/index.js";
import { settingsOf } from "../internal/constants.js";
import { isThenable, runChain } from "../internal/run-chain.js";
import { ZonixRequest } from "../request.js";
import type { ZonixResponse } from "../response.js";
import type { ErrorMiddleware, Handler, HttpMethod, Middleware, Next } from "../types.js";
import { RouteTable } from "./index.js";
import { normalize } from "./normalize.js";

/** Express-style `use()` arguments: an optional mount path, then middleware. */
export interface UseArgs {
  prefix: string;
  fns: Array<Middleware | ErrorMiddleware | MountableRouter>;
}

/** A `use()` entry with the mount prefix it was registered under (`""` = everywhere). */
export interface Layer {
  prefix: string;
  fn: Middleware;
}

const METHODS: readonly HttpMethod[] = ["get", "post", "put", "patch", "delete", "head", "options"];

/**
 * Does `path` sit at or under the mount `prefix`? Segment-aligned: `/api`
 * matches `/api` and `/api/x`, never `/apix`. An empty prefix matches all.
 */
export function matchesPrefix(path: string, prefix: string): boolean {
  if (prefix.length === 0) return true;
  if (!path.startsWith(prefix)) return false;
  return path.length === prefix.length || path.charCodeAt(prefix.length) === 47; /* '/' */
}

/** Canonical mount prefix: leading slash required, trailing slash dropped, `/` → `""`. */
function normalizePrefix(
  path: string,
  caller: (...args: never[]) => unknown,
  what: string,
): string {
  if (!path.startsWith("/")) {
    throw frameworkError(
      `${what} mount path must start with "/", received ${JSON.stringify(path)}`,
      caller,
      ErrorCode.INVALID_ROUTE,
    );
  }
  if (path.indexOf(":") !== -1 || path.indexOf("*") !== -1) {
    throw frameworkError(
      `${what} mount path must be a static prefix (no ":param" or "*"), received ${JSON.stringify(path)}`,
      caller,
      ErrorCode.INVALID_ROUTE,
    );
  }
  const normalized = normalize(path);
  return normalized === "/" ? "" : normalized;
}

/** Split `use(path?, ...fns)` into its prefix and validated functions. */
export function parseUse(
  args: readonly unknown[],
  caller: (...args: never[]) => unknown,
  what: string,
): UseArgs {
  let prefix = "";
  let rest: readonly unknown[] = args;
  if (typeof args[0] === "string") {
    prefix = normalizePrefix(args[0], caller, what);
    rest = args.slice(1);
  }
  if (rest.length === 0) {
    throw frameworkError(
      `${what} requires at least one middleware`,
      caller,
      ErrorCode.INVALID_ARGUMENT,
    );
  }
  for (const fn of rest) {
    if (typeof fn !== "function" && !(fn instanceof MountableRouter)) {
      throw frameworkError(
        `${what} expects functions or routers, received ${typeof fn}`,
        caller,
        ErrorCode.INVALID_ARGUMENT,
      );
    }
  }
  return { prefix, fns: rest as UseArgs["fns"] };
}

/** Express's rule: a four-argument function is an error handler. */
export function isErrorMiddleware(fn: unknown): fn is ErrorMiddleware {
  return typeof fn === "function" && fn.length === 4;
}

/**
 * Wrap a middleware so it runs only under `prefix`, with `req.url` stripped of
 * the prefix and `req.baseUrl` extended for its duration — restored when it
 * calls `next()`. `req.originalUrl` is captured before the first rewrite.
 * With an empty prefix the function is returned as-is (nothing to do).
 */
export function mountLayer(prefix: string, fn: Middleware): Middleware {
  if (prefix.length === 0) return fn;
  return function mounted(req, res, next) {
    if (!matchesPrefix(req.path, prefix)) return next();
    void req.originalUrl;
    const url = req.url ?? "/";
    const base = req.baseUrl;
    const rest = url.slice(prefix.length);
    ZonixRequest.rewrite(
      req,
      rest.length === 0 || rest.charCodeAt(0) === 63 /* '?' */ ? "/" + rest : rest,
      base + prefix,
    );
    let restored = false;
    return fn(req, res, (err) => {
      if (!restored) {
        restored = true;
        ZonixRequest.rewrite(req, url, base);
      }
      next(err);
    });
  };
}

/** Scope an error middleware to a mount prefix. */
export function scopeErrorLayer(prefix: string, fn: ErrorMiddleware): ErrorMiddleware {
  if (prefix.length === 0) return fn;
  return function scoped(err, req, res, next) {
    if (!matchesPrefix(req.path, prefix)) return next(err);
    return fn(err, req, res, next);
  };
}

/**
 * Run error middleware in order. Each layer either answers, calls `next(err)`
 * to pass a (possibly new) error on, or calls `next()` to pass the same error
 * on; a throw or rejection inside a layer becomes the error for the next one.
 * When the layers are exhausted, `done` receives whatever error is current.
 */
export function runErrorLayers(
  layers: readonly ErrorMiddleware[],
  err: unknown,
  req: ZonixRequest,
  res: ZonixResponse,
  done: (err: unknown) => void,
): void {
  let index = 0;
  const step = (current: unknown): void => {
    const layer = layers[index++];
    if (layer === undefined) {
      done(current);
      return;
    }
    let advanced = false;
    const next: Next = (e) => {
      if (advanced) return;
      advanced = true;
      step(e === undefined || e === null ? current : e);
    };
    const fail = (e: unknown): void => {
      if (advanced) return;
      advanced = true;
      step(e);
    };
    try {
      const result = layer(toError(current), req, res, next);
      if (isThenable(result)) result.then(undefined, fail);
    } catch (e) {
      fail(e);
    }
  };
  step(err);
}

/** Validate and register one route on a table (shared by the app and routers). */
export function registerRoute(
  table: RouteTable,
  method: string,
  path: string,
  rest: readonly unknown[],
  caller: (...args: never[]) => unknown,
  what: string,
): void {
  if (typeof method !== "string" || method.length === 0) {
    throw frameworkError(
      `${what} requires an HTTP method string`,
      caller,
      ErrorCode.INVALID_ARGUMENT,
    );
  }
  if (typeof path !== "string" || !path.startsWith("/")) {
    throw frameworkError(
      `Route path must start with "/", received ${JSON.stringify(path)}`,
      caller,
      ErrorCode.INVALID_ROUTE,
    );
  }
  const handler = rest[rest.length - 1];
  if (typeof handler !== "function") {
    throw frameworkError(
      `${what}("${method}", "${path}") needs a handler function as its last argument`,
      caller,
      ErrorCode.INVALID_ARGUMENT,
    );
  }
  const middleware = rest.slice(0, -1);
  for (const mw of middleware) {
    if (typeof mw !== "function") {
      throw frameworkError(
        `Route middleware must be functions, received ${typeof mw}`,
        caller,
        ErrorCode.INVALID_ARGUMENT,
      );
    }
  }
  table.add(method, path, middleware as Middleware[], handler as Handler);
}

/**
 * A mountable router: its own route table, its own ordered `use()` stack
 * (plain middleware, prefixed middleware, nested routers) and its own error
 * middleware, mounted on an app or another router with `use(path, router)`.
 *
 * Order inside a router follows the app's rule: every `use()` entry runs (in
 * registration order, each under its own prefix), then the matched route's
 * middleware and handler. A request nothing here answers continues with the
 * parent's `next()`; an error runs this router's error middleware first and
 * only then the parent's.
 */
export class MountableRouter {
  readonly #table = new RouteTable();
  readonly #stack: Middleware[] = [];
  readonly #errors: ErrorMiddleware[] = [];

  /** `use(fn)`, `use(path, fn)`, `use(path, router)`, `use((err, req, res, next) => ...)`. */
  use(...middleware: Middleware[]): this;
  use(path: string, ...middleware: Middleware[]): this;
  use(...middleware: ErrorMiddleware[]): this;
  use(path: string, ...middleware: ErrorMiddleware[]): this;
  use(...routers: MountableRouter[]): this;
  use(path: string, ...routers: MountableRouter[]): this;
  use(...args: unknown[]): this {
    const { prefix, fns } = parseUse(args, this.use, "router.use()");
    for (const fn of fns) {
      if (fn instanceof MountableRouter) {
        this.#stack.push(mountLayer(prefix, fn.handle));
      } else if (isErrorMiddleware(fn)) {
        this.#errors.push(scopeErrorLayer(prefix, fn));
      } else {
        this.#stack.push(mountLayer(prefix, fn as Middleware));
      }
    }
    return this;
  }

  /** Register a route relative to wherever this router is mounted. */
  route(method: string, path: string, ...rest: [...Middleware[], Handler]): this {
    registerRoute(this.#table, method, path, rest, this.route, "router.route()");
    return this;
  }

  /**
   * The router as middleware. Bound once per router so `app.use(router)` and
   * `app.use("/api", router)` both hand out the same function.
   */
  readonly handle: Middleware = (req, res, next) => {
    let match;
    try {
      match = this.#table.find(
        req.method ?? "GET",
        req.path,
        settingsOf(req.socket).maxParamLength,
      );
    } catch (err) {
      this.#fail(err, req, res, next);
      return;
    }
    if (match === undefined && this.#stack.length === 0) {
      next();
      return;
    }
    const chain: Middleware[] = this.#stack.slice();
    if (match !== undefined) {
      req.params = match.params;
      for (const mw of match.route.middleware) chain.push(mw);
      chain.push(match.route.handler);
    }
    // Exhausted without answering: hand the request back to the parent.
    chain.push(() => next());
    runChain(chain, req, res, settingsOf(req.socket).dev, (err) => {
      this.#fail(err, req, res, next);
    });
  };

  #fail(err: unknown, req: ZonixRequest, res: ZonixResponse, next: Next): void {
    if (this.#errors.length === 0) {
      next(err);
      return;
    }
    runErrorLayers(this.#errors, err, req, res, (remaining) => next(remaining));
  }

  declare get: (path: string, ...rest: [...Middleware[], Handler]) => this;
  declare post: (path: string, ...rest: [...Middleware[], Handler]) => this;
  declare put: (path: string, ...rest: [...Middleware[], Handler]) => this;
  declare patch: (path: string, ...rest: [...Middleware[], Handler]) => this;
  declare delete: (path: string, ...rest: [...Middleware[], Handler]) => this;
  declare head: (path: string, ...rest: [...Middleware[], Handler]) => this;
  declare options: (path: string, ...rest: [...Middleware[], Handler]) => this;
}

for (const method of METHODS) {
  Object.defineProperty(MountableRouter.prototype, method, {
    value: function (this: MountableRouter, path: string, ...rest: [...Middleware[], Handler]) {
      return this.route(method, path, ...rest);
    },
    writable: true,
    enumerable: false,
    configurable: true,
  });
}

export type Router = MountableRouter;

export interface RouterFactory {
  (): Router;
  new (): Router;
}

/** `zonix.Router()` — callable with or without `new`, as Express's is. */
export const Router: RouterFactory = function Router(): Router {
  return new MountableRouter();
} as unknown as RouterFactory;
// `instanceof Router` must hold for routers made either way.
(Router as unknown as { prototype: unknown }).prototype = MountableRouter.prototype;

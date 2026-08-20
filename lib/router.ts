import { ErrorCode, frameworkError } from "./errors.js";
import { EMPTY, type Handler, type Middleware, type StringMap } from "./types.js";

export interface RouteMatch {
  params: StringMap;
  middleware: readonly Middleware[];
  handler: Handler;
}

interface Route {
  middleware: readonly Middleware[];
  handler: Handler;
}

/**
 * Phase 1 router: exact-path lookup, one map per method. Replaced by the radix
 * tree in phase 2 — the `add`/`find` surface is what the rest of the framework
 * depends on and does not change.
 */
export class Router {
  readonly #methods = new Map<string, Map<string, Route>>();

  add(method: string, path: string, middleware: readonly Middleware[], handler: Handler): void {
    const key = method.toLowerCase();
    let table = this.#methods.get(key);
    if (table === undefined) {
      table = new Map();
      this.#methods.set(key, table);
    }
    if (table.has(path)) {
      throw frameworkError(
        `Duplicate route: ${method.toUpperCase()} ${path} is already registered`,
        this.add,
        ErrorCode.DUPLICATE_ROUTE,
      );
    }
    table.set(path, { middleware, handler });
  }

  find(method: string, path: string): RouteMatch | undefined {
    const route = this.#methods.get(method.toLowerCase())?.get(path);
    if (route === undefined) return undefined;
    return { params: EMPTY, middleware: route.middleware, handler: route.handler };
  }
}

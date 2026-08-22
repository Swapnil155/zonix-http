import { ErrorCode, frameworkError } from "../errors/index.js";
import { EMPTY } from "../internal/constants.js";
import type { Handler, Middleware, StringMap } from "../types.js";
import { Node, walk, walkPath, zip, type MethodTree, type Route } from "./radix.js";
import { decodeSegment, normalize, splitPath } from "./normalize.js";

export type { Route } from "./radix.js";

export interface RouteMatch {
  params: StringMap;
  route: Route;
}

/**
 * Radix router: a segment-keyed tree per HTTP method.
 *
 * Matching walks segment by segment, preferring a static child, then the param
 * child, then a tail wildcard, and **backtracks**: if the static branch dead-ends
 * deeper in the tree the walk retries the param branch at that same depth.
 * Captured values ride in a positional array and are zipped with the names stored
 * on the matched leaf, so `/:id/profile` and `/:username/settings` can legally
 * share a param slot.
 */
export class Router {
  readonly #methods = new Map<string, MethodTree>();

  /**
   * Register a route.
   *
   * @throws when the pattern is malformed (bad wildcard, empty or repeated param
   * name) or when the same method + normalized path is already registered.
   */
  add(method: string, path: string, middleware: readonly Middleware[], handler: Handler): void {
    const segments = splitPath(path);
    const paramNames: string[] = [];

    // Stored uppercase because that is how `req.method` arrives off the wire:
    // the hot path then needs no per-request case conversion.
    const key = method.toUpperCase();
    let tree = this.#methods.get(key);
    if (tree === undefined) {
      tree = { root: new Node(), exact: new Map() };
      this.#methods.set(key, tree);
    }

    let node = tree.root;
    let dynamic = false;

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i] as string;

      if (segment.charCodeAt(0) === 58 /* ':' */) {
        const name = segment.slice(1);
        if (name.length === 0) {
          throw frameworkError(
            `Route "${path}" has an empty param name; write ":id", not ":"`,
            this.add,
            ErrorCode.INVALID_ROUTE,
          );
        }
        if (name === "__proto__" || name === "constructor" || name === "prototype") {
          // req.params is a plain object (see radix.ts zip); these names are
          // the only way a route pattern could reach its prototype chain.
          throw frameworkError(
            `Route "${path}": ":${name}" is not an allowed param name`,
            this.add,
            ErrorCode.INVALID_ROUTE,
          );
        }
        if (paramNames.includes(name)) {
          throw frameworkError(
            `Route "${path}" has a duplicate param name ":${name}"`,
            this.add,
            ErrorCode.INVALID_ROUTE,
          );
        }
        paramNames.push(name);
        dynamic = true;
        node.paramChild ??= new Node();
        node = node.paramChild;
        continue;
      }

      if (segment.charCodeAt(0) === 42 /* '*' */) {
        if (segment.length > 1) {
          throw frameworkError(
            `Route "${path}": named wildcards are not supported. Use "*" and read req.params["*"]`,
            this.add,
            ErrorCode.INVALID_ROUTE,
          );
        }
        if (i !== segments.length - 1) {
          throw frameworkError(
            `Route "${path}": "*" is only allowed as the final segment`,
            this.add,
            ErrorCode.INVALID_ROUTE,
          );
        }
        paramNames.push("*");
        dynamic = true;
        node.wildcardChild ??= new Node();
        node = node.wildcardChild;
        continue;
      }

      node.staticChildren ??= new Map();
      let child = node.staticChildren.get(segment);
      if (child === undefined) {
        child = new Node();
        node.staticChildren.set(segment, child);
      }
      node = child;
    }

    if (node.route !== undefined) {
      throw frameworkError(
        `Duplicate route: ${method.toUpperCase()} ${normalize(path)} is already registered`,
        this.add,
        ErrorCode.DUPLICATE_ROUTE,
      );
    }

    const route: Route = {
      middleware,
      handler,
      paramNames,
      pipeline: undefined,
      pipelineVersion: -1,
    };
    node.route = route;
    if (!dynamic) tree.exact.set(normalize(path), route);
  }

  /**
   * Find the route for a request path (query string already stripped).
   *
   * @throws a 400-tagged framework error when a segment cannot be percent-decoded.
   */
  find(method: string, path: string): RouteMatch | undefined {
    // Direct hit first: `req.method` is already uppercase for every well-formed
    // request. The fallback keeps matching case-insensitive for anything odd.
    let tree = this.#methods.get(method);
    if (tree === undefined) {
      tree = this.#methods.get(method.toUpperCase());
      if (tree === undefined) {
        // HEAD is answered by the GET route when no HEAD route exists, as
        // Express and Fastify do; node:http drops the body on the wire.
        if (method === "HEAD" || method.toUpperCase() === "HEAD") return this.find("GET", path);
        return undefined;
      }
    }

    // Fast path: no encoding to undo, no trailing slash to trim, fully static route.
    if (path.indexOf("%") === -1) {
      const direct = tree.exact.get(path);
      if (direct !== undefined) return { params: EMPTY, route: direct };
    }

    const captured: string[] = [];
    let route: Route | undefined;
    if (path.indexOf("%") === -1) {
      // Common case: nothing to decode, so the tree is descended straight off
      // the URL string with no segment array and no second pass.
      route = walkPath(tree.root, path, 1, captured);
    } else {
      // Percent-encoded: decode every segment up front, exactly as v1 did, so a
      // malformed escape anywhere in the URL is a 400 even if nothing matches.
      const segments = splitPath(path);
      for (let i = 0; i < segments.length; i++) {
        segments[i] = decodeSegment(segments[i] as string, path);
      }
      route = walk(tree.root, segments, 0, captured);
    }
    if (route === undefined) {
      return method === "HEAD" && tree !== this.#methods.get("GET")
        ? this.find("GET", path)
        : undefined;
    }

    return { params: zip(route.paramNames, captured), route };
  }
}

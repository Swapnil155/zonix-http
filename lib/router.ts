import { ErrorCode, frameworkError } from "./errors.js";
import { EMPTY, type Handler, type Middleware, type StringMap } from "./types.js";

export interface RouteMatch {
  params: StringMap;
  route: Route;
}

/** A registered endpoint. `paramNames` is zipped with the values captured during the walk. */
export interface Route {
  middleware: readonly Middleware[];
  handler: Handler;
  paramNames: readonly string[];
  /**
   * Cache slot owned by the app: this route's global + route middleware +
   * handler, flattened into one array. Built on first use and reused until
   * `pipelineVersion` no longer matches the app's global-middleware version.
   */
  pipeline: Middleware[] | undefined;
  pipelineVersion: number;
}

/**
 * One node per path segment.
 *
 * Children are split three ways so match priority is a property of the walk
 * rather than of insertion order: `static` first, then `param`, then `wildcard`.
 */
class Node {
  staticChildren: Map<string, Node> | undefined = undefined;
  paramChild: Node | undefined = undefined;
  /** Tail wildcard. Always a leaf: nothing can follow `*`. */
  wildcardChild: Node | undefined = undefined;
  route: Route | undefined = undefined;
}

/** One tree per HTTP method, plus an exact-path map for the fully static routes. */
interface MethodTree {
  root: Node;
  /** Fast path: normalized path -> route, for routes with no params or wildcards. */
  exact: Map<string, Route>;
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
      if (tree === undefined) return undefined;
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
    if (route === undefined) return undefined;

    return { params: zip(route.paramNames, captured), route };
  }
}

/**
 * Depth-first walk with backtracking, in priority order: static, param, wildcard.
 * Values pushed onto `captured` are popped again when a branch is abandoned, so
 * the array always mirrors the branch currently being explored.
 */
function walk(
  node: Node,
  segments: string[],
  index: number,
  captured: string[],
): Route | undefined {
  if (index === segments.length) {
    if (node.route !== undefined) return node.route;
    // "/files" may still be served by "/files/*" with an empty tail.
    const wildcard = node.wildcardChild;
    if (wildcard?.route !== undefined) {
      captured.push("");
      return wildcard.route;
    }
    return undefined;
  }

  const segment = segments[index] as string;

  const staticChild = node.staticChildren?.get(segment);
  if (staticChild !== undefined) {
    const found = walk(staticChild, segments, index + 1, captured);
    if (found !== undefined) return found;
  }

  if (node.paramChild !== undefined) {
    captured.push(segment);
    const found = walk(node.paramChild, segments, index + 1, captured);
    if (found !== undefined) return found;
    captured.pop();
  }

  const wildcard = node.wildcardChild;
  if (wildcard?.route !== undefined) {
    captured.push(segments.slice(index).join("/"));
    return wildcard.route;
  }

  return undefined;
}

/**
 * The same descent as `walk`, driven straight off the URL string.
 *
 * `start` is the index just past the slash that introduced this level. Repeated
 * slashes are skipped here, which is what makes `/a//b` and `/a/b` the same
 * route without a normalization pass. Only reached for paths with no percent
 * escapes, so no segment ever needs decoding.
 */
function walkPath(node: Node, path: string, start: number, captured: string[]): Route | undefined {
  const length = path.length;
  let from = start;
  while (from < length && path.charCodeAt(from) === 47 /* '/' */) from++;

  if (from >= length) {
    if (node.route !== undefined) return node.route;
    const wildcard = node.wildcardChild;
    if (wildcard?.route !== undefined) {
      captured.push("");
      return wildcard.route;
    }
    return undefined;
  }

  let end = path.indexOf("/", from);
  if (end === -1) end = length;
  const segment = path.slice(from, end);

  const staticChild = node.staticChildren?.get(segment);
  if (staticChild !== undefined) {
    const found = walkPath(staticChild, path, end, captured);
    if (found !== undefined) return found;
  }

  if (node.paramChild !== undefined) {
    captured.push(segment);
    const found = walkPath(node.paramChild, path, end, captured);
    if (found !== undefined) return found;
    captured.pop();
  }

  const wildcard = node.wildcardChild;
  if (wildcard?.route !== undefined) {
    // The tail keeps v1's shape: empty segments collapsed, joined with "/".
    captured.push(splitPath(path.slice(from - 1)).join("/"));
    return wildcard.route;
  }

  return undefined;
}

/**
 * Split into segments, dropping empties. This collapses repeated slashes and
 * makes the trailing-slash policy fall out for free: `/users` and `/users/`
 * produce the same segment list, so they are the same route.
 */
function splitPath(path: string): string[] {
  const segments: string[] = [];
  let start = 1; // every path starts with "/"
  for (let i = 1; i <= path.length; i++) {
    if (i === path.length || path.charCodeAt(i) === 47 /* '/' */) {
      if (i > start) segments.push(path.slice(start, i));
      start = i + 1;
    }
  }
  return segments;
}

/** Canonical form used for duplicate detection and the exact-match fast path. */
function normalize(path: string): string {
  const segments = splitPath(path);
  return segments.length === 0 ? "/" : `/${segments.join("/")}`;
}

function decodeSegment(segment: string, path: string): string {
  if (segment.indexOf("%") === -1) return segment;
  try {
    return decodeURIComponent(segment);
  } catch {
    throw frameworkError(`Cannot decode path: ${path}`, decodeSegment, ErrorCode.BAD_ENCODING, 400);
  }
}

function zip(names: readonly string[], values: readonly string[]): StringMap {
  if (names.length === 0) return EMPTY;
  const params: StringMap = Object.create(null) as StringMap;
  for (let i = 0; i < names.length; i++) {
    params[names[i] as string] = values[i] ?? "";
  }
  return params;
}

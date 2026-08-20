import { EMPTY } from "../internal/constants.js";
import type { Handler, Middleware, StringMap } from "../types.js";
import { splitPath } from "./normalize.js";

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
export class Node {
  staticChildren: Map<string, Node> | undefined = undefined;
  paramChild: Node | undefined = undefined;
  /** Tail wildcard. Always a leaf: nothing can follow `*`. */
  wildcardChild: Node | undefined = undefined;
  route: Route | undefined = undefined;
}

/** One tree per HTTP method, plus an exact-path map for the fully static routes. */
export interface MethodTree {
  root: Node;
  /** Fast path: normalized path -> route, for routes with no params or wildcards. */
  exact: Map<string, Route>;
}

/**
 * Depth-first walk with backtracking, in priority order: static, param, wildcard.
 * Values pushed onto `captured` are popped again when a branch is abandoned, so
 * the array always mirrors the branch currently being explored.
 */
export function walk(
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
export function walkPath(
  node: Node,
  path: string,
  start: number,
  captured: string[],
): Route | undefined {
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

export function zip(names: readonly string[], values: readonly string[]): StringMap {
  if (names.length === 0) return EMPTY;
  const params: StringMap = Object.create(null) as StringMap;
  for (let i = 0; i < names.length; i++) {
    params[names[i] as string] = values[i] ?? "";
  }
  return params;
}

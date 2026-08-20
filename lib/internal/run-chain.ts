import type { ZonixRequest } from "../request.js";
import type { ZonixResponse } from "../response.js";
import type { Middleware, Next } from "../types.js";

/**
 * Run a chain of middleware to completion.
 *
 * Synchronous by design: a chain whose middleware all call `next()` inline
 * finishes without allocating a promise or scheduling a microtask. Async
 * machinery is entered only when a middleware actually returns a thenable.
 * `onError` receives the first error surfaced by `next(err)`, a synchronous
 * throw or a rejected promise, and is called at most once. Like Express, a
 * middleware that neither responds nor calls `next()` simply parks the request.
 */
export function runChain(
  chain: readonly Middleware[],
  req: ZonixRequest,
  res: ZonixResponse,
  dev: boolean,
  onError: (err: unknown) => void,
): void {
  // Once the chain has finished or failed, a late rejection from a middleware
  // that already called next() is ignored - the same as a settled promise.
  let settled = false;
  const fail = (err: unknown): void => {
    if (settled) return;
    settled = true;
    onError(err);
  };

  const step = (index: number): void => {
    const mw = chain[index];
    if (mw === undefined) {
      settled = true;
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
        fail(err);
        return;
      }
      step(index + 1);
    };

    let result: unknown;
    try {
      result = mw(req, res, next);
    } catch (err) {
      fail(err);
      return;
    }
    // A rejection is an error; resolving does NOT advance the chain.
    if (isThenable(result)) result.then(undefined, fail);
  };

  step(0);
}

export function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    typeof (value as PromiseLike<unknown>).then === "function"
  );
}

import { IncomingMessage } from "node:http";
import { EMPTY, type StringMap } from "./types.js";

/**
 * The request object handed to every middleware and handler.
 *
 * Installed via `http.createServer({ IncomingMessage })` — the prototype of the
 * stock `http.IncomingMessage` is never touched. `body`, `params` and `cookies`
 * are declared as class fields so V8 sees one hidden class for every request and
 * never has to transition an object shape mid-flight.
 */
export class ZonixRequest extends IncomingMessage {
  /** Populated by a body parser such as `parseJSON()`. `undefined` until then. */
  body: unknown = undefined;

  /** Route parameters for the matched route. Shared frozen empty object when the route has none. */
  params: StringMap = EMPTY;

  /** Populated by `cookieParser()`. Shared frozen empty object until then. */
  cookies: StringMap = EMPTY;

  #query: StringMap | undefined = undefined;
  #path: string | undefined = undefined;

  /**
   * Parsed query string, computed on first access and cached for the life of the
   * request. Repeated keys collapse to the last value. The returned object is a
   * plain mutable object (middleware may amend it); an empty query returns the
   * shared frozen `EMPTY`.
   */
  get query(): StringMap {
    if (this.#query !== undefined) return this.#query;
    const url = this.url ?? "";
    const q = url.indexOf("?");
    if (q === -1 || q === url.length - 1) return (this.#query = EMPTY);

    const out: StringMap = {};
    let found = false;
    for (const [key, value] of new URLSearchParams(url.slice(q + 1))) {
      out[key] = value;
      found = true;
    }
    return (this.#query = found ? out : EMPTY);
  }

  /** Request path with the query string removed. Not percent-decoded. */
  get path(): string {
    if (this.#path !== undefined) return this.#path;
    const url = this.url ?? "/";
    const q = url.indexOf("?");
    return (this.#path = q === -1 ? url : url.slice(0, q));
  }
}

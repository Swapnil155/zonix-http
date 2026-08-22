import { IncomingMessage, type IncomingHttpHeaders } from "node:http";
import {
  getHeader,
  getHost,
  getHostname,
  getIp,
  getIps,
  getProtocol,
  getSubdomains,
  isXhr,
  typeIs,
} from "./compat/request.js";
import { EMPTY, settingsOf } from "./internal/constants.js";
import { resolveType } from "./http/mime.js";
import {
  preferredCharsets,
  preferredEncodings,
  preferredLanguages,
  preferredMediaTypes,
} from "./negotiation/index.js";
import { fresh as isFresh } from "./http/fresh.js";
import { parseRange, type RangeOptions, type Ranges } from "./http/range.js";
import { parseQuery } from "./query/simple.js";
import type { ZonixResponse } from "./response.js";
import type { StringMap, ZonixSettings } from "./types.js";

/** Everything an Express-compat accessor computes once and then reuses. */
interface CompatCache {
  originalUrl?: string;
  protocol?: string;
  host?: string | undefined;
  hostname?: string | undefined;
  subdomains?: string[];
  ip?: string | undefined;
  ips?: string[];
}

/**
 * The request object handed to every middleware and handler.
 *
 * Installed via `http.createServer({ IncomingMessage })` — the prototype of the
 * stock `http.IncomingMessage` is never touched. `body`, `params` and `cookies`
 * are declared as class fields so V8 sees one hidden class for every request and
 * never has to transition an object shape mid-flight.
 *
 * The Express compat surface below follows performance rule 1: every one of
 * these is a getter that computes on first touch and caches into a single
 * lazily-created object. A request that reads none of them allocates nothing
 * for them and never calls into `compat/`.
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
  #compat: CompatCache | undefined = undefined;
  #res: ZonixResponse | undefined = undefined;
  #baseUrl = "";

  /**
   * @internal Mounting: swap `url` (and so `path`) for the duration of a
   * mounted layer and set the mount prefix. The query cache is kept - the
   * query string is the same either way. Not public API.
   */
  static rewrite(req: ZonixRequest, url: string, baseUrl: string): void {
    req.url = url;
    req.#path = undefined;
    req.#baseUrl = baseUrl;
  }

  /**
   * Link the response this request will be answered with. One pointer store
   * per request, done by the server callback; `fresh`/`stale` need the
   * response's validators and Node links only the other direction (`res.req`).
   */
  static attachResponse(req: ZonixRequest, res: ZonixResponse): void {
    req.#res = res;
  }

  /**
   * Parsed query string, computed on first access and cached for the life of the
   * request. Repeated keys collapse to the last value. The returned object is a
   * plain mutable object (middleware may amend it); an empty query returns the
   * shared frozen `EMPTY`.
   */
  get query(): StringMap {
    if (this.#query !== undefined) return this.#query;
    return (this.#query = parseQuery(this.url ?? ""));
  }

  /** Request path with the query string removed. Not percent-decoded. */
  get path(): string {
    if (this.#path !== undefined) return this.#path;
    const url = this.url ?? "/";
    const q = url.indexOf("?");
    return (this.#path = q === -1 ? url : url.slice(0, q));
  }

  // --- Express compat surface ------------------------------------------------

  /**
   * A request header, case-insensitively.
   *
   * `referer` and `referrer` alias one another. `set-cookie` comes back as an
   * array; everything else Node joined already comes back as a string.
   */
  get(name: string): string | string[] | undefined {
    return getHeader(this.headers, name);
  }

  /** Alias of `get()`, for handlers copied from the Express docs. */
  header(name: string): string | string[] | undefined {
    return getHeader(this.headers, name);
  }

  /**
   * The URL as it arrived, before any mount stripped its prefix. Captured on
   * first read; the mount code reads it before the first rewrite.
   */
  get originalUrl(): string {
    const cache = (this.#compat ??= {});
    return (cache.originalUrl ??= this.url ?? "");
  }

  /** The mount prefix the current layer was mounted under (`""` at the top level). */
  get baseUrl(): string {
    return this.#baseUrl;
  }

  /** `"https"` when the connection is TLS, or when a trusted proxy says so. */
  get protocol(): string {
    const cache = (this.#compat ??= {});
    if (cache.protocol !== undefined) return cache.protocol;
    const settings = this.#settings();
    const encrypted = (this.socket as { encrypted?: boolean } | null)?.encrypted === true;
    return (cache.protocol = getProtocol(
      this.headers,
      encrypted,
      this.socket?.remoteAddress,
      settings.trust,
    ));
  }

  /** `true` when `protocol` is https. */
  get secure(): boolean {
    return this.protocol === "https";
  }

  /**
   * The host **including its port**, e.g. `example.com:3000`.
   *
   * Express 5 semantics, per decision D6 — Express 4 returned the port-stripped
   * form here. Use `hostname` when you want that.
   */
  get host(): string | undefined {
    const cache = (this.#compat ??= {});
    if (!("host" in cache)) {
      cache.host = getHost(this.headers, this.socket?.remoteAddress, this.#settings().trust);
    }
    return cache.host;
  }

  /**
   * Host without its port.
   *
   * Bracketed IPv6 survives intact: `[::1]:3000` gives `[::1]`, which the
   * obvious `split(":")[0]` would turn into `"["`.
   */
  get hostname(): string | undefined {
    const cache = (this.#compat ??= {});
    if (!("hostname" in cache)) {
      cache.hostname = getHostname(
        this.headers,
        this.socket?.remoteAddress,
        this.#settings().trust,
      );
    }
    return cache.hostname;
  }

  /** Host labels below the registrable domain, outermost last. Empty for an IP host. */
  get subdomains(): string[] {
    const cache = (this.#compat ??= {});
    return (cache.subdomains ??= getSubdomains(this.hostname, this.#settings().subdomainOffset));
  }

  /**
   * The client address.
   *
   * With `trustProxy` off (the default) this is the socket address and no
   * header can change it.
   */
  get ip(): string | undefined {
    const cache = (this.#compat ??= {});
    if (!("ip" in cache)) {
      cache.ip = getIp(this.headers, this.socket?.remoteAddress, this.#settings().trust);
    }
    return cache.ip;
  }

  /** The trusted `X-Forwarded-For` chain, client first. Empty when trust is off. */
  get ips(): string[] {
    const cache = (this.#compat ??= {});
    return (cache.ips ??= getIps(this.headers, this.socket?.remoteAddress, this.#settings().trust));
  }

  /** `true` when `X-Requested-With` is `XMLHttpRequest`. */
  get xhr(): boolean {
    return isXhr(this.headers);
  }

  /**
   * Content-type test.
   *
   * Returns the **matched type string** (not `true`), `false` when nothing
   * matches, and `null` when the request declares no body at all — so
   * `if (req.is("json"))` works and `req.is("json") === null` still tells you
   * there was nothing to parse.
   */
  is(...types: Array<string | readonly string[]>): string | false | null {
    const flat = types.length === 1 && Array.isArray(types[0]) ? types[0] : types;
    return typeIs(this.headers, flat as readonly unknown[]);
  }

  /**
   * Content negotiation, Express-style (the `accepts` package's semantics,
   * pinned by differential test to `negotiator@0.6.3`).
   *
   * - No arguments: every type the client accepts, best first.
   * - With types (spread or array): the FIRST provided type the client
   *   accepts, returned exactly as you wrote it (`"json"` stays `"json"`),
   *   or `false`. Extensions resolve through the MIME table; unknown ones
   *   are skipped, not errors.
   * - No `Accept` header at all: the first type you offered — Express treats
   *   silence as "anything".
   *
   * Computed on every call (performance rule 1: nothing is parsed until a
   * handler asks, and most never do).
   */
  accepts(): string[];
  accepts(...types: Array<string | readonly string[]>): string | false;
  accepts(...types: Array<string | readonly string[]>): string[] | string | false {
    const flat = flatten(types);
    if (flat.length === 0) return preferredMediaTypes(acceptHeader(this.headers, "accept"));
    if (!this.headers.accept) return flat[0] as string;

    const mimes = flat.map((t) => resolveType(t));
    const valid = mimes.filter((m): m is string => typeof m === "string");
    const first = preferredMediaTypes(this.headers.accept, valid)[0];
    return first === undefined ? false : (flat[mimes.indexOf(first)] as string);
  }

  /** Preferred encodings, or the first acceptable of those offered (or `false`). */
  acceptsEncodings(): string[];
  acceptsEncodings(...encodings: Array<string | readonly string[]>): string | false;
  acceptsEncodings(...encodings: Array<string | readonly string[]>): string[] | string | false {
    const flat = flatten(encodings);
    const header = acceptHeader(this.headers, "accept-encoding");
    if (flat.length === 0) return preferredEncodings(header);
    return preferredEncodings(header, flat)[0] ?? false;
  }

  /** Preferred charsets, or the first acceptable of those offered (or `false`). */
  acceptsCharsets(): string[];
  acceptsCharsets(...charsets: Array<string | readonly string[]>): string | false;
  acceptsCharsets(...charsets: Array<string | readonly string[]>): string[] | string | false {
    const flat = flatten(charsets);
    const header = acceptHeader(this.headers, "accept-charset");
    if (flat.length === 0) return preferredCharsets(header);
    return preferredCharsets(header, flat)[0] ?? false;
  }

  /** Preferred languages, or the first acceptable of those offered (or `false`). */
  acceptsLanguages(): string[];
  acceptsLanguages(...languages: Array<string | readonly string[]>): string | false;
  acceptsLanguages(...languages: Array<string | readonly string[]>): string[] | string | false {
    const flat = flatten(languages);
    const header = acceptHeader(this.headers, "accept-language");
    if (flat.length === 0) return preferredLanguages(header);
    return preferredLanguages(header, flat)[0] ?? false;
  }

  /**
   * Conditional GET: is the client's cached copy still good?
   *
   * Express semantics, pinned by the `fresh@0.5.2` differential: only GET and
   * HEAD can be fresh, only against a 2xx or 304 status, and the comparison
   * uses the `ETag` / `Last-Modified` the response has set SO FAR - so read it
   * after setting them, as the Express docs do.
   */
  get fresh(): boolean {
    const method = this.method;
    if (method !== "GET" && method !== "HEAD") return false;
    const res = this.#res;
    if (res === undefined) return false;
    const status = res.statusCode;
    if ((status >= 200 && status < 300) || status === 304) {
      return isFresh(this.headers, {
        etag: headerString(res.getHeader("ETag")),
        "last-modified": headerString(res.getHeader("Last-Modified")),
      });
    }
    return false;
  }

  /** `!fresh`. */
  get stale(): boolean {
    return !this.fresh;
  }

  /**
   * Parse the `Range` header against a resource of `size` bytes.
   *
   * `undefined` when there is no header; `-2` when it is malformed; `-1` when
   * no range is satisfiable; otherwise the ranges with the unit on `.type`.
   * `range-parser@1.2.1` semantics, including `{ combine: true }`.
   */
  range(size: number, options?: RangeOptions): Ranges | -1 | -2 | undefined {
    const header = this.headers.range;
    if (!header) return undefined;
    return parseRange(size, header, options);
  }

  /** The app's compiled settings, reached through the server this socket belongs to. */
  #settings(): ZonixSettings {
    return settingsOf(this.socket);
  }
}

/** `accepts("a", "b")` and `accepts(["a", "b"])` are the same call. */
function flatten(args: ReadonlyArray<string | readonly string[]>): string[] {
  if (args.length === 1 && Array.isArray(args[0])) return [...(args[0] as readonly string[])];
  return args.filter((a): a is string => typeof a === "string");
}

/**
 * A header as the negotiator wants it: `undefined` when absent (which means
 * "accept anything"), joined when Node gives us an array.
 */
function acceptHeader(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = (headers as Record<string, string | string[] | undefined>)[name];
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value.join(", ") : value;
}

/** A response header as `fresh` wants it: the string, or undefined. */
function headerString(value: number | string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string") return value;
  return Array.isArray(value) ? value.join(", ") : String(value);
}

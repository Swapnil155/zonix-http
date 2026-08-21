import { IncomingMessage } from "node:http";
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
import { parseQuery } from "./query/simple.js";
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
   * The URL as it arrived.
   *
   * Captured on first read. Today nothing rewrites `req.url`, so this equals
   * `url`; when router mounting lands it must be captured before the prefix is
   * stripped, and that is the mount code's job.
   */
  get originalUrl(): string {
    const cache = (this.#compat ??= {});
    return (cache.originalUrl ??= this.url ?? "");
  }

  /**
   * The mount prefix this request was matched under.
   *
   * Always `""` until router mounting exists — which is what Express reports
   * for an un-mounted app, so this is correct rather than a placeholder.
   */
  get baseUrl(): string {
    return "";
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

  /** The app's compiled settings, reached through the server this socket belongs to. */
  #settings(): ZonixSettings {
    return settingsOf(this.socket);
  }
}

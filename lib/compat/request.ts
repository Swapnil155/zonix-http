import type { IncomingHttpHeaders } from "node:http";
import { ErrorCode, frameworkError } from "../errors/index.js";
import { lookupMime } from "../http/mime.js";
import { allAddresses, proxyAddress, trustedAddresses, type TrustFunction } from "../http/proxy.js";

/**
 * Express `req` semantics, as pure functions.
 *
 * The accessors themselves are declared on `ZonixRequest` (decision 10: compat
 * is core, not a shim, and never a runtime patch) and delegate here. Keeping the
 * logic out of the class keeps it testable in isolation and keeps `request.ts`
 * readable.
 *
 * Every rule below was checked against the installed Express sources rather than
 * from memory; the comments flag the places where an obvious implementation is
 * wrong.
 */

/** Headers whose duplicates Node drops, keeping the first occurrence. */
const FIRST_WINS = new Set([
  "age",
  "authorization",
  "content-length",
  "content-type",
  "etag",
  "expires",
  "from",
  "host",
  "if-modified-since",
  "if-unmodified-since",
  "last-modified",
  "location",
  "max-forwards",
  "proxy-authorization",
  "referer",
  "retry-after",
  "server",
  "user-agent",
]);

/**
 * `req.get(name)` / `req.header(name)`.
 *
 * Two things an obvious implementation gets wrong:
 * - `referer` and `referrer` alias each other, and the expression is exactly
 *   `headers.referrer || headers.referer`. A present-but-empty `referer`
 *   therefore yields `""`, not `undefined`.
 * - a name of `__proto__` or `constructor` would otherwise walk the prototype
 *   chain of the headers object and return `Object`/`Function`. Node's headers
 *   object is an ordinary object, so this is a live hazard, not a hypothetical.
 */
export function getHeader(
  headers: IncomingHttpHeaders,
  name: unknown,
): string | string[] | undefined {
  if (typeof name !== "string") {
    throw frameworkError(
      name === undefined || name === null
        ? "req.get(name) requires a header name"
        : "req.get(name) requires a header name as a string",
      getHeader,
      ErrorCode.INVALID_ARGUMENT,
    );
  }

  const lower = name.toLowerCase();
  if (lower === "referer" || lower === "referrer") {
    return own(headers, "referrer") || own(headers, "referer");
  }
  return own(headers, lower);
}

/** Own-property read, so `__proto__` and `constructor` cannot escape upward. */
function own(headers: IncomingHttpHeaders, key: string): string | string[] | undefined {
  return Object.prototype.hasOwnProperty.call(headers, key)
    ? (headers as Record<string, string | string[] | undefined>)[key]
    : undefined;
}

/** Header value as a single string; joins the array form Node produces. */
function headerString(headers: IncomingHttpHeaders, key: string): string | undefined {
  const value = own(headers, key);
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value.join(", ") : value;
}

/** True when duplicates of `name` are collapsed to the first by Node. */
export function isFirstWins(name: string): boolean {
  return FIRST_WINS.has(name.toLowerCase());
}

/** `req.xhr` — note the `|| ""`, not a `String()` coercion. */
export function isXhr(headers: IncomingHttpHeaders): boolean {
  const value = headerString(headers, "x-requested-with") ?? "";
  return value.toLowerCase() === "xmlhttprequest";
}

/**
 * `req.protocol`.
 *
 * The trust function is consulted exactly once, with the socket's own address at
 * hop 0. When trusted, the LEFTMOST value of `X-Forwarded-Proto` wins — the
 * client-most one, the same orientation as `hostname` and `ips`.
 */
export function getProtocol(
  headers: IncomingHttpHeaders,
  encrypted: boolean,
  remoteAddress: string | undefined,
  trust: TrustFunction,
): string {
  const base = encrypted ? "https" : "http";
  if (!trust(remoteAddress, 0)) return base;

  const forwarded = headerString(headers, "x-forwarded-proto");
  if (forwarded === undefined) return base;
  const comma = forwarded.indexOf(",");
  const value = (comma === -1 ? forwarded : forwarded.slice(0, comma)).trim();
  return value.length > 0 ? value : base;
}

/**
 * `req.hostname` — the host with any port removed.
 *
 * The port strip is the trap. `"[::1]:3000".split(":")[0]` is `"["`, so an
 * IPv6 literal has to be handled by finding the closing bracket first and only
 * then looking for a colon after it.
 *
 * The trust function is called at most once, and not at all when
 * `X-Forwarded-Host` is absent — Express short-circuits, and a test that counts
 * trust invocations can see the difference.
 */
export function getHostname(
  headers: IncomingHttpHeaders,
  remoteAddress: string | undefined,
  trust: TrustFunction,
): string | undefined {
  let host = headerString(headers, "x-forwarded-host");
  if (host !== undefined && host.length > 0) {
    if (!trust(remoteAddress, 0)) {
      host = headerString(headers, "host");
    } else {
      // Only the first entry of a forwarded list is the client-most host.
      const comma = host.indexOf(",");
      if (comma !== -1) host = host.slice(0, comma).trimEnd();
    }
  } else {
    host = headerString(headers, "host");
  }
  if (host === undefined || host.length === 0) return undefined;

  if (host.charCodeAt(0) === 0x5b /* [ */) {
    const close = host.indexOf("]");
    // An unterminated bracket is malformed; Express hands back the truncation.
    return close === -1 ? host.slice(0, 1) : host.slice(0, close + 1);
  }
  const colon = host.indexOf(":");
  return colon === -1 ? host : host.slice(0, colon);
}

/**
 * `req.subdomains` — host labels below the registrable part, in reverse order.
 *
 * `offset` (default 2) is how many trailing labels count as the domain, so
 * `a.b.example.com` yields `["b", "a"]`. An IP-address host has no subdomains.
 */
export function getSubdomains(hostname: string | undefined, offset: number): string[] {
  if (hostname === undefined) return [];
  // Bracketed IPv6 and bare IPv4/IPv6 are addresses, not names.
  if (hostname.charCodeAt(0) === 0x5b || isIpLiteral(hostname)) return [];
  return hostname.split(".").reverse().slice(offset);
}

function isIpLiteral(host: string): boolean {
  if (host.includes(":")) return true; // bare IPv6
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

/** `req.ip` — the client-most address that is not itself a trusted hop. */
export function getIp(
  headers: IncomingHttpHeaders,
  remoteAddress: string | undefined,
  trust: TrustFunction,
): string | undefined {
  const addresses = allAddresses(remoteAddress, headerString(headers, "x-forwarded-for"));
  const address = proxyAddress(addresses, trust);
  return address.length > 0 ? address : undefined;
}

/**
 * `req.ips` — the trusted forwarded chain, client first.
 *
 * Express builds the nearest-first list, reverses it and drops the socket
 * address, which leaves the `X-Forwarded-For` chain in its original
 * left-to-right order. With trust off the result is empty.
 */
export function getIps(
  headers: IncomingHttpHeaders,
  remoteAddress: string | undefined,
  trust: TrustFunction,
): string[] {
  // Truncated at the first untrusted hop FIRST, then reversed and stripped of
  // the socket address. Without the truncation this would hand back whatever
  // chain the client typed into the header.
  const addresses = trustedAddresses(
    allAddresses(remoteAddress, headerString(headers, "x-forwarded-for")),
    trust,
  );
  addresses.reverse().pop();
  return addresses;
}

/**
 * `req.is(types)`.
 *
 * Returns the MATCHED TYPE STRING on a match — not `true`. `false` on no match,
 * and `null` when the request has no body at all, which callers distinguish.
 */
export function typeIs(
  headers: IncomingHttpHeaders,
  types: readonly unknown[],
): string | false | null {
  if (!hasBody(headers)) return null;

  const actual = normalizeContentType(headerString(headers, "content-type"));
  if (actual === undefined) return false;
  if (types.length === 0) return actual;

  for (const candidate of types) {
    if (typeof candidate !== "string" || candidate.length === 0) continue;
    if (matchesType(actual, candidate)) return candidate;
  }
  return false;
}

/**
 * Express treats a request as having a body when it declares one — a
 * `transfer-encoding` at all, or a `content-length` that parses.
 */
function hasBody(headers: IncomingHttpHeaders): boolean {
  if (own(headers, "transfer-encoding") !== undefined) return true;
  const length = headerString(headers, "content-length");
  return length !== undefined && !Number.isNaN(Number(length));
}

/**
 * Lowercased `type/subtype`, parameters dropped.
 *
 * The surrounding trim is OWS only (space and tab) rather than
 * `String.prototype.trim`, which would also eat newlines and other Unicode
 * whitespace that are not legal here.
 */
function normalizeContentType(header: string | undefined): string | undefined {
  if (header === undefined) return undefined;
  const semicolon = header.indexOf(";");
  const raw = semicolon === -1 ? header : header.slice(0, semicolon);
  const value = raw.replace(/^[ \t]+|[ \t]+$/g, "").toLowerCase();
  if (value.length === 0) return undefined;
  // Must be a syntactically plausible type/subtype.
  const slash = value.indexOf("/");
  if (slash <= 0 || slash === value.length - 1) return undefined;
  return value;
}

/** Expand `req.is("json")`-style shorthands, then match with wildcard rules. */
function matchesType(actual: string, candidate: string): boolean {
  let expected = candidate.toLowerCase();

  // Two shorthands are hard-coded rather than looked up, exactly as type-is
  // does: neither "urlencoded" nor "multipart" is a file extension, so a MIME
  // table lookup would miss them. "multipart" is also the only shorthand whose
  // expansion contains a wildcard.
  if (expected === "urlencoded") expected = "application/x-www-form-urlencoded";
  else if (expected === "multipart") expected = "multipart/*";
  // A bare structured suffix expands to a full wildcard pattern: "+json"
  // becomes "*/*+json", which is what makes it match any vendor type.
  else if (expected.charCodeAt(0) === 0x2b /* + */) expected = `*/*${expected}`;

  if (!expected.includes("/")) {
    // A bare word is a file-extension-style shorthand: json, html, text...
    const mapped = lookupMime(`x.${expected}`);
    if (mapped === undefined) return false;
    expected = stripParameters(mapped);
  }

  if (expected === "*/*") return true;

  const [expectedType, expectedSubtype] = splitType(expected);
  const [actualType, actualSubtype] = splitType(actual);

  if (expectedType !== "*" && expectedType !== actualType) return false;
  if (expectedSubtype === "*") return true;

  if (expectedSubtype.startsWith("*+")) {
    // "*+json" matches any subtype ending in "+json", but not the bare
    // "json" subtype: the length guard is what excludes application/json.
    const suffix = expectedSubtype.slice(1);
    return expectedSubtype.length <= actualSubtype.length + 1 && actualSubtype.endsWith(suffix);
  }
  return expectedSubtype === actualSubtype;
}

function stripParameters(value: string): string {
  const semicolon = value.indexOf(";");
  return (semicolon === -1 ? value : value.slice(0, semicolon)).trim().toLowerCase();
}

function splitType(value: string): [string, string] {
  const slash = value.indexOf("/");
  if (slash === -1) return [value, ""];
  return [value.slice(0, slash), value.slice(slash + 1)];
}

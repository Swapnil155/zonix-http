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
 * `req.host` — the host **including its port** (decision D6).
 *
 * Express 5 semantics. Express 4's `req.host` was an alias of `hostname` with
 * the port stripped, which its own documentation calls a wart; the difference
 * belongs in the README compat table.
 *
 * The trust function is consulted at most once, and not at all when
 * `X-Forwarded-Host` is absent — Express short-circuits, and a test that counts
 * trust invocations can see the difference.
 */
export function getHost(
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
  return host === undefined || host.length === 0 ? undefined : host;
}

/**
 * `req.hostname` — `host` with any port removed.
 *
 * The port strip is the trap. `"[::1]:3000".split(":")[0]` is `"["`, so the
 * search for the port colon must start *after* the closing bracket of an IPv6
 * literal.
 */
export function getHostname(
  headers: IncomingHttpHeaders,
  remoteAddress: string | undefined,
  trust: TrustFunction,
): string | undefined {
  const host = getHost(headers, remoteAddress, trust);
  if (host === undefined) return undefined;

  const offset = host.charCodeAt(0) === 0x5b /* [ */ ? host.indexOf("]") + 1 : 0;
  const colon = host.indexOf(":", offset);
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
    if (!matchesType(actual, candidate)) continue;
    // A wildcard or suffix pattern returns the *matched* type, not the pattern:
    // `req.is("application/*")` on a JSON request gives "application/json", so
    // the caller learns what actually arrived rather than what they asked for.
    //
    // Note this contradicts the Express documentation, which states
    // `req.is('application/*') // => 'application/*'`. The installed
    // `type-is` returns `val` for these patterns, and the differential test
    // proves real Express does too. Rule 8: the oracle outranks the docs.
    return candidate.startsWith("+") || candidate.includes("*") ? actual : candidate;
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
 * The normalized `type/subtype[+suffix]` a request declares, parameters dropped
 * — or `undefined` if the content-type is not well-formed.
 *
 * This is a faithful port of what `type-is` does to the *actual* header:
 * `media-typer.parse` then `format` with the parameters cleared. Two subtleties
 * that a naive "slice at the first `;` and lowercase" gets wrong, both found by
 * the seeded fuzz differential:
 *
 *  1. **Parameters are validated, not merely dropped (ZH-030).** A structurally
 *     malformed parameter section makes the WHOLE content-type invalid —
 *     `media-typer` throws, so `req.is` sees no type and must fail closed.
 *     Salvaging just `b/text` from `b/text;*` (a parameter with no name) let it
 *     match the `*` wildcard and hand the caller a bogus type.
 *  2. **The subtype's structured-syntax suffix is split at the LAST `+` and
 *     each half is revalidated,** with an empty suffix dropped — so `a/a+`
 *     normalizes to `a/a`, `a/b+c+json` and `a/b+c.d` are rejected (a suffix is
 *     a plain type-name: no `.`, no further `+`). This mirrors `splitType` +
 *     `format`'s second validation pass.
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
  // Exactly one slash. The type name allows neither `.` nor `+`; the subtype as
  // first parsed allows both. Checking only for "a slash somewhere" was too lax:
  // it let "a/b/c" through, which then matched `req.is("*/*")`.
  const slash = value.indexOf("/");
  if (slash <= 0 || slash === value.length - 1) return undefined;
  const type = value.slice(0, slash);
  const subtype = value.slice(slash + 1);
  if (!isName(type, 0, type.length, false, false)) return undefined;
  if (!isName(subtype, 0, subtype.length, true, true)) return undefined;

  // Split the structured-syntax suffix off the subtype at the LAST `+`, then
  // revalidate: the core subtype allows `.` but not `+`; a non-empty suffix is
  // a plain type-name (neither). An empty suffix (a trailing `+`) is dropped.
  const plus = subtype.lastIndexOf("+");
  let normalizedSubtype = subtype;
  if (plus !== -1) {
    const core = subtype.slice(0, plus);
    const suffix = subtype.slice(plus + 1);
    if (!isName(core, 0, core.length, true, false)) return undefined;
    if (suffix.length === 0) {
      normalizedSubtype = core;
    } else {
      if (!isName(suffix, 0, suffix.length, false, false)) return undefined;
      normalizedSubtype = `${core}+${suffix}`;
    }
  }

  // Only once the type is known valid do the parameters decide validity — they
  // are validated on the RAW header (parameter validity is case-insensitive)
  // from the first `;`.
  if (semicolon !== -1 && !validParameters(header, semicolon)) return undefined;
  return `${type}/${normalizedSubtype}`;
}

/**
 * Is `header[start..]` a well-formed `*( ";" OWS parameter )` tail?
 *
 * Mirrors `media-typer@0.3.0`'s `paramRegExp` as a linear scan (decision 11 —
 * no backtracking regex): each parameter is `";" OWS token OWS "=" OWS
 * ( token / quoted-string ) OWS`, the parameters are contiguous, and the tail
 * must consume the rest of the header. OWS is space only (not tab), exactly as
 * the oracle's regex. Any deviation returns `false`, which fails the whole
 * content-type closed.
 *
 * @param start index of the first `;` in `header`.
 */
function validParameters(header: string, start: number): boolean {
  const length = header.length;
  let i = start;
  while (i < length) {
    if (header.charCodeAt(i) !== 0x3b /* ; */) return false;
    i++;
    while (i < length && header.charCodeAt(i) === 0x20) i++; // OWS
    const nameStart = i;
    while (i < length && isParamToken(header.charCodeAt(i))) i++;
    if (i === nameStart) return false; // parameter must have a name
    while (i < length && header.charCodeAt(i) === 0x20) i++; // OWS
    if (i >= length || header.charCodeAt(i) !== 0x3d /* = */) return false;
    i++;
    while (i < length && header.charCodeAt(i) === 0x20) i++; // OWS
    if (i < length && header.charCodeAt(i) === 0x22 /* " */) {
      i++;
      let closed = false;
      while (i < length) {
        const c = header.charCodeAt(i);
        if (c === 0x5c /* \ */) {
          // quoted-pair: backslash then any 0x20–0x7e character.
          i++;
          if (i >= length) return false;
          const q = header.charCodeAt(i);
          if (q < 0x20 || q > 0x7e) return false;
          i++;
          continue;
        }
        if (c === 0x22 /* " */) {
          i++;
          closed = true;
          break;
        }
        // qdtext: SP, "!", 0x23–0x5b, 0x5d–0x7e, 0x80–0xff.
        if (
          c === 0x20 ||
          c === 0x21 ||
          (c >= 0x23 && c <= 0x5b) ||
          (c >= 0x5d && c <= 0x7e) ||
          (c >= 0x80 && c <= 0xff)
        ) {
          i++;
          continue;
        }
        return false;
      }
      if (!closed) return false;
    } else {
      const valueStart = i;
      while (i < length && isParamToken(header.charCodeAt(i))) i++;
      if (i === valueStart) return false; // parameter must have a value
    }
    while (i < length && header.charCodeAt(i) === 0x20) i++; // OWS before next ";"
  }
  return true;
}

/**
 * RFC 2616 token char, per `media-typer`'s parameter grammar — broader than the
 * RFC 6838 type-name set: `%`, `'`, `*`, `` ` ``, `|`, `~` are all legal here.
 */
function isParamToken(c: number): boolean {
  return (
    (c >= 0x30 && c <= 0x39) || // 0-9
    (c >= 0x41 && c <= 0x5a) || // A-Z
    (c >= 0x61 && c <= 0x7a) || // a-z
    c === 0x21 || // !
    c === 0x23 || // #
    c === 0x24 || // $
    c === 0x25 || // %
    c === 0x26 || // &
    c === 0x27 || // '
    c === 0x2a || // *
    c === 0x2b || // +
    c === 0x2d || // -
    c === 0x2e || // .
    c === 0x5e || // ^
    c === 0x5f || // _
    c === 0x60 || // `
    c === 0x7c || // |
    c === 0x7e /* ~ */
  );
}

/**
 * Is `value[start, end)` a legal RFC 6838 type or subtype name?
 *
 * This is `media-typer`'s rule, which `type-is` parses with and which is
 * markedly stricter than an RFC 7230 token: the name must **start** with an
 * alphanumeric, `.` and `+` are legal only in the subtype, and `*`, `'`, `|`,
 * `~`, `%` and backtick are not legal at all. Length is capped at 127.
 *
 * The strictness is the point. A laxer check let malformed headers such as
 * `-/99y` through, where they matched a wildcard pattern and handed the caller
 * a nonsense type; the seeded fuzz differential against `type-is` found them.
 *
 * A linear char-code scan rather than a character class, per decision 11.
 *
 * `.` and `+` are gated separately because `media-typer` treats them as three
 * distinct grammars: a **type name** allows neither (`typeNameRegExp`); a raw
 * **subtype** as first parsed allows both (`typeRegExp`); but the subtype
 * *after the suffix is split off* allows `.` and not `+` (`subtypeNameRegExp`),
 * and the **suffix** itself allows neither. See {@link normalizeContentType}.
 *
 * @param allowDot  `.` is a legal non-initial character.
 * @param allowPlus `+` is a legal non-initial character.
 */
function isName(
  value: string,
  start: number,
  end: number,
  allowDot: boolean,
  allowPlus: boolean,
): boolean {
  const length = end - start;
  if (length < 1 || length > 127) return false;

  for (let i = start; i < end; i++) {
    const c = value.charCodeAt(i);
    // 0-9 or a-z; the caller has already lowercased.
    if ((c >= 0x30 && c <= 0x39) || (c >= 0x61 && c <= 0x7a)) continue;
    // The first character must be alphanumeric; the rest may be punctuation.
    if (i === start) return false;
    // ! # $ & ^ _ -
    if (
      c === 0x21 ||
      c === 0x23 ||
      c === 0x24 ||
      c === 0x26 ||
      c === 0x5e ||
      c === 0x5f ||
      c === 0x2d
    ) {
      continue;
    }
    if (allowDot && c === 0x2e) continue;
    if (allowPlus && c === 0x2b) continue;
    return false;
  }
  return true;
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

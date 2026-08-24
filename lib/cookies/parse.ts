import { EMPTY, settingsOf } from "../internal/constants.js";
import type { Middleware, StringMap } from "../types.js";
import { unsign } from "./sign.js";

/**
 * A cookie value after parsing: the string from the wire, or — for `j:` JSON
 * cookies, which `res.cookie` writes for object values — whatever JSON shape
 * was stored. Signed cookies additionally use `false` for a failed signature.
 */
export type CookieValue =
  string | number | boolean | null | CookieValue[] | { [key: string]: CookieValue };

export type Cookies = Record<string, CookieValue>;
export type SignedCookies = Record<string, CookieValue | false>;

/**
 * Parse the `Cookie` header into `req.cookies` and `req.signedCookies`.
 *
 * Semantics match `cookie-parser` (the rule-8 oracle, pinned at 1.4.7):
 *
 * - A value prefixed `s:` is a signed cookie. With a secret available, a valid
 *   signature moves the original value to `req.signedCookies`; a broken one
 *   becomes `false` there. Either way the entry leaves `req.cookies`, so
 *   nothing attacker-editable can shadow a verified value.
 * - Secrets: the explicit argument wins; without one, the app's `cookieSecret`
 *   is used. An array supports rotation — verification tries each in order,
 *   signing (in `res.cookie`) always uses the app secret. With no secret at
 *   all, `s:` values stay raw in `req.cookies` and `req.signedCookies` is
 *   empty, exactly as `cookie-parser` behaves without one.
 * - A value prefixed `j:` (what `res.cookie` writes for objects) is revived
 *   with `JSON.parse`; a malformed one stays a string. `JSON.parse` cannot
 *   touch prototypes — a `"__proto__"` key in the payload is an inert own
 *   property — and both maps are null-prototype.
 *
 * Values are percent-decoded when they decode cleanly and left verbatim when
 * they do not, so a malformed cookie can never fail a request. The first
 * occurrence of a repeated name wins, matching browsers.
 */
export function cookieParser(secret?: string | readonly string[]): Middleware {
  const explicit = normalizeSecrets(secret);
  return function cookieParserMiddleware(req, _res, next) {
    const header = req.headers.cookie;
    if (header === undefined || header.length === 0) {
      req.cookies = EMPTY;
      req.signedCookies = EMPTY;
      return next();
    }

    const secrets = explicit ?? normalizeSecrets(settingsOf(req.socket).cookieSecret) ?? [];
    const { cookies, signed } = splitCookies(parseCookieHeader(header), secrets);
    req.cookies = cookies;
    req.signedCookies = signed;
    next();
  };
}

function normalizeSecrets(
  secret: string | readonly string[] | undefined,
): readonly string[] | undefined {
  if (secret === undefined) return undefined;
  if (typeof secret === "string") return secret.length > 0 ? [secret] : [];
  return secret;
}

/**
 * Split parsed cookies into the unsigned map (JSON-revived) and the verified
 * signed map. Exported for the oracle differential.
 */
export function splitCookies(
  parsed: StringMap,
  secrets: readonly string[],
): { cookies: Cookies; signed: SignedCookies } {
  const cookies: Cookies = Object.create(null) as Cookies;
  let signed: SignedCookies = EMPTY;

  for (const name of Object.keys(parsed)) {
    const value = parsed[name] as string;

    if (secrets.length > 0 && value.startsWith("s:")) {
      if (signed === EMPTY) signed = Object.create(null) as SignedCookies;
      signed[name] = unsignWith(value.slice(2), secrets);
      continue; // verified or not, a signed cookie never stays in req.cookies
    }

    cookies[name] = jsonCookie(value);
  }

  return { cookies: Object.keys(cookies).length > 0 ? cookies : EMPTY, signed };
}

function unsignWith(value: string, secrets: readonly string[]): CookieValue | false {
  for (const secret of secrets) {
    const original = unsign(value, secret);
    if (original !== false) return jsonCookie(original);
  }
  return false;
}

/** Revive a `j:` JSON cookie; anything else — including broken JSON — is returned as-is. */
function jsonCookie(value: string): CookieValue {
  if (!value.startsWith("j:")) return value;
  try {
    return JSON.parse(value.slice(2)) as CookieValue;
  } catch {
    return value;
  }
}

/** Exported for tests; the middleware is the supported entry point. */
export function parseCookieHeader(header: string): StringMap {
  // Null-prototype: a "__proto__" cookie is then plain data, not a hazard.
  const cookies: StringMap = Object.create(null) as StringMap;
  let found = false;
  let start = 0;

  while (start <= header.length) {
    let end = header.indexOf(";", start);
    if (end === -1) end = header.length;

    const pair = header.slice(start, end);
    start = end + 1;

    const eq = pair.indexOf("=");
    if (eq < 1) continue; // no name, or a valueless flag - skip it

    const name = pair.slice(0, eq).trim();
    if (name.length === 0 || Object.prototype.hasOwnProperty.call(cookies, name)) continue;

    // Only the first "=" splits: the value may contain more of them.
    let value = pair.slice(eq + 1).trim();
    if (
      value.length >= 2 &&
      value.charCodeAt(0) === 34 &&
      value.charCodeAt(value.length - 1) === 34
    ) {
      value = value.slice(1, -1);
    }
    cookies[name] = decode(value);
    found = true;
  }

  return found ? cookies : EMPTY;
}

function decode(value: string): string {
  if (value.indexOf("%") === -1) return value;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

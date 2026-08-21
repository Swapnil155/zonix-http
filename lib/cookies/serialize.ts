import { ErrorCode, frameworkError } from "../errors/index.js";

/**
 * `Set-Cookie` serialization — an inlined equivalent of the `cookie` package.
 *
 * The security properties here are load-bearing, not incidental:
 *
 * - **Attribute injection.** A `;` in a value would otherwise start a new
 *   attribute, letting a user-supplied value set `Path`, `Domain` or clear
 *   `HttpOnly`. The default encoder (`encodeURIComponent`) makes that
 *   impossible, and the encoded value is validated *afterwards* so a custom
 *   encoder cannot smuggle one through either.
 * - **CRLF injection.** Blocked twice over: the value pattern excludes every C0
 *   control, and `node:http` rejects them again at `setHeader`. Both layers stay.
 * - **`path` and `domain` are interpolated raw** and so are validated with their
 *   own patterns; they are injection vectors in exactly the same way.
 *
 * The attribute order below is fixed and matches the `cookie` package byte for
 * byte, independent of the order keys appear in the options object.
 */

// These three checks are the security boundary, so they are written as linear
// char-code scans rather than character-class regexes: the ranges involved are
// full of characters that are painful to escape correctly ("]", "\", quotes),
// and decision 11 asks for linear parsing anyway.

/** RFC 6265 cookie-name: an RFC 7230 token. */
function isToken(value: string): boolean {
  if (value.length === 0) return false;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    const alphanumeric =
      (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);
    if (alphanumeric) continue;
    // ! # $ % & ' * + - . ^ _ ` | ~
    if (
      c === 0x21 ||
      (c >= 0x23 && c <= 0x27) ||
      c === 0x2a ||
      c === 0x2b ||
      c === 0x2d ||
      c === 0x2e ||
      c === 0x5e ||
      c === 0x5f ||
      c === 0x60 ||
      c === 0x7c ||
      c === 0x7e
    ) {
      continue;
    }
    return false;
  }
  return true;
}

/**
 * cookie-value: no controls, no space, and none of `"` `,` `;` `\`.
 * A matched pair of surrounding double quotes is allowed.
 */
function isCookieValue(value: string): boolean {
  let start = 0;
  let end = value.length;
  if (end >= 2 && value.charCodeAt(0) === 0x22 && value.charCodeAt(end - 1) === 0x22) {
    start = 1;
    end -= 1;
  }
  for (let i = start; i < end; i++) {
    const c = value.charCodeAt(i);
    // 0x21, 0x23-0x2B, 0x2D-0x3A, 0x3C-0x5B, 0x5D-0x7E
    if (
      c === 0x21 ||
      (c >= 0x23 && c <= 0x2b) ||
      (c >= 0x2d && c <= 0x3a) ||
      (c >= 0x3c && c <= 0x5b) ||
      (c >= 0x5d && c <= 0x7e)
    ) {
      continue;
    }
    return false;
  }
  return true;
}

/** Path: printable ASCII, but not `;` (0x3B) and not DEL. */
function isCookiePath(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if ((c >= 0x20 && c <= 0x3a) || (c >= 0x3d && c <= 0x7e)) continue;
    return false;
  }
  return true;
}

/** Domain: hostname labels only. Plain ASCII, so a regex is safe here. */
const DOMAIN_PATTERN =
  /^([.]?[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)([.][a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;

export type SameSite = boolean | "lax" | "strict" | "none";

export interface CookieOptions {
  /** Lifetime in **milliseconds** (Express's unit), converted to seconds on the wire. */
  maxAge?: number | undefined;
  expires?: Date | undefined;
  path?: string | undefined;
  domain?: string | undefined;
  httpOnly?: boolean | undefined;
  secure?: boolean | undefined;
  partitioned?: boolean | undefined;
  priority?: "low" | "medium" | "high" | undefined;
  sameSite?: SameSite | undefined;
  /** Replace the default `encodeURIComponent`. The result is still validated. */
  encode?: ((value: string) => string) | undefined;
  /** Sign the value with the app's cookie secret. */
  signed?: boolean | undefined;
}

/**
 * Build one `Set-Cookie` value.
 *
 * @throws when the name, the encoded value, the path or the domain would let
 * something escape into the header.
 */
export function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
  // Read `encode` as an OWN property. A plain lookup walks the prototype chain,
  // so a polluted `Object.prototype.encode` would take over value encoding for
  // every cookie the app sets — which is exactly the escaping that stops
  // attribute injection. Express reads it plainly and is exposed to this.
  const encode = Object.prototype.hasOwnProperty.call(options, "encode")
    ? options.encode
    : undefined;
  const encoder = encode ?? encodeURIComponent;
  if (typeof encoder !== "function") {
    throw frameworkError(
      "res.cookie(): encode must be a function",
      serializeCookie,
      ErrorCode.INVALID_ARGUMENT,
    );
  }
  // The name is checked unencoded; the value is checked AFTER encoding, which is
  // what closes the custom-encoder hole.
  if (typeof name !== "string" || !isToken(name)) {
    throw frameworkError(
      `res.cookie(): invalid cookie name ${JSON.stringify(name)}`,
      serializeCookie,
      ErrorCode.INVALID_ARGUMENT,
    );
  }

  // encodeURIComponent throws URIError on a lone surrogate, which would
  // otherwise surface as a bare "URI malformed" with no hint that a cookie
  // caused it.
  let encoded: string;
  try {
    encoded = encoder(value);
  } catch (err) {
    throw frameworkError(
      `res.cookie(): could not encode the value for ${JSON.stringify(name)}: ${(err as Error).message}`,
      serializeCookie,
      ErrorCode.INVALID_ARGUMENT,
    );
  }
  if (!isCookieValue(encoded)) {
    throw frameworkError(
      `res.cookie(): invalid cookie value for ${JSON.stringify(name)}`,
      serializeCookie,
      ErrorCode.INVALID_ARGUMENT,
    );
  }

  let header = `${name}=${encoded}`;

  if (options.maxAge !== undefined && options.maxAge !== null) {
    const maxAge = Math.floor(options.maxAge);
    if (!Number.isFinite(maxAge)) {
      throw frameworkError(
        "res.cookie(): maxAge must be a finite number",
        serializeCookie,
        ErrorCode.INVALID_ARGUMENT,
      );
    }
    header += `; Max-Age=${maxAge}`;
  }

  if (options.domain !== undefined) {
    if (!DOMAIN_PATTERN.test(options.domain)) {
      throw frameworkError(
        `res.cookie(): invalid domain ${JSON.stringify(options.domain)}`,
        serializeCookie,
        ErrorCode.INVALID_ARGUMENT,
      );
    }
    header += `; Domain=${options.domain}`;
  }

  if (options.path !== undefined) {
    if (!isCookiePath(options.path)) {
      throw frameworkError(
        `res.cookie(): invalid path ${JSON.stringify(options.path)}`,
        serializeCookie,
        ErrorCode.INVALID_ARGUMENT,
      );
    }
    header += `; Path=${options.path}`;
  }

  if (options.expires !== undefined) {
    const expires = options.expires;
    if (!(expires instanceof Date) || Number.isNaN(expires.getTime())) {
      throw frameworkError(
        "res.cookie(): expires must be a valid Date",
        serializeCookie,
        ErrorCode.INVALID_ARGUMENT,
      );
    }
    header += `; Expires=${expires.toUTCString()}`;
  }

  if (options.httpOnly === true) header += "; HttpOnly";
  if (options.secure === true) header += "; Secure";
  if (options.partitioned === true) header += "; Partitioned";

  if (options.priority !== undefined) {
    switch (options.priority.toLowerCase()) {
      case "low":
        header += "; Priority=Low";
        break;
      case "medium":
        header += "; Priority=Medium";
        break;
      case "high":
        header += "; Priority=High";
        break;
      default:
        throw frameworkError(
          `res.cookie(): invalid priority ${JSON.stringify(options.priority)}`,
          serializeCookie,
          ErrorCode.INVALID_ARGUMENT,
        );
    }
  }

  if (options.sameSite !== undefined && options.sameSite !== false) {
    const sameSite =
      typeof options.sameSite === "string" ? options.sameSite.toLowerCase() : options.sameSite;
    switch (sameSite) {
      case true:
      case "strict":
        header += "; SameSite=Strict";
        break;
      case "lax":
        header += "; SameSite=Lax";
        break;
      case "none":
        header += "; SameSite=None";
        break;
      default:
        throw frameworkError(
          `res.cookie(): invalid sameSite ${JSON.stringify(options.sameSite)}`,
          serializeCookie,
          ErrorCode.INVALID_ARGUMENT,
        );
    }
  }

  return header;
}

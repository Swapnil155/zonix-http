import { createHmac, timingSafeEqual } from "node:crypto";
import { ErrorCode, frameworkError } from "../errors/index.js";

/**
 * Cookie signing — wire-compatible with `cookie-signature`.
 *
 * Format: `s:` + value + `.` + base64(HMAC-SHA256(value, secret)).
 *
 * Three details are wire-compatibility-critical and easy to get wrong:
 *
 * - **The `s:` prefix is outside the HMAC but inside the URL encoding.** Only
 *   the raw value is signed; `s:` is prepended afterwards, and the whole thing
 *   is percent-encoded last. Signing `"s:" + value`, or encoding before signing,
 *   produces cookies that no other Express app can read.
 * - **Standard base64, padding stripped.** `base64url` would emit `-` and `_`
 *   and silently break interop.
 * - **Comparison is timing-safe.** The reference implementation compares hashes
 *   with `==`, which is variable-time; `timingSafeEqual` over equal-length
 *   digests removes the oracle entirely.
 */

const PREFIX = "s:";

/** `value.signature`, base64 without padding. */
export function sign(value: string, secret: string): string {
  if (typeof value !== "string") {
    throw frameworkError("sign(): value must be a string", sign, ErrorCode.INVALID_ARGUMENT);
  }
  if (typeof secret !== "string" || secret.length === 0) {
    throw frameworkError(
      "sign(): a non-empty secret is required",
      sign,
      ErrorCode.INVALID_ARGUMENT,
    );
  }
  return `${value}.${digest(value, secret)}`;
}

/**
 * Verify a signed value.
 *
 * Returns the original value, or `false` when the signature does not match.
 * `false` rather than a throw because an invalid cookie is an everyday event —
 * a rotated secret, a stale browser — not an exceptional one.
 */
export function unsign(signed: string, secret: string): string | false {
  if (typeof signed !== "string" || typeof secret !== "string" || secret.length === 0) return false;

  const separator = signed.lastIndexOf(".");
  // A leading separator means an empty value, which cookie-signature accepts;
  // only a missing separator is malformed.
  if (separator === -1) return false;

  const value = signed.slice(0, separator);
  const provided = signed.slice(separator + 1);
  const expected = digest(value, secret);

  // Compare the digests, which are always the same length, so the length check
  // itself leaks nothing about the secret.
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b) ? value : false;
}

/** Add the `s:` marker a signed cookie carries on the wire. */
export function markSigned(signedValue: string): string {
  return PREFIX + signedValue;
}

/** Strip the `s:` marker, or `undefined` when the value is not marked signed. */
export function stripSignedMarker(value: string): string | undefined {
  return value.startsWith(PREFIX) ? value.slice(PREFIX.length) : undefined;
}

function digest(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64").replace(/=+$/, ""); // padding is stripped on the wire
}

import { ErrorCode, frameworkError } from "../errors/index.js";
import { DEFAULT_MIME, resolveType } from "../http/mime.js";

/**
 * Express `res` semantics, as pure functions.
 *
 * As with `compat/request.ts`, the accessors live on `ZonixResponse` (decision
 * 10) and delegate here, so the rules stay testable on their own.
 *
 * The named traps, and where each is handled:
 * - **CRLF injection** in `location`/`redirect` — {@link encodeUrl}.
 * - **Header injection** through `set()` — {@link assertHeaderValue}.
 * - **Cookie attribute injection** — `cookies/serialize.ts`.
 * - **`Content-Disposition` filenames** — `http/content-disposition.ts`.
 * - **`send` content-type inference** — {@link inferSendType}.
 */

/** `charset=` already present in a content-type. */
const CHARSET_PATTERN = /;\s*charset\s*=/i;

/**
 * Types that get `; charset=utf-8` appended when the caller did not say.
 *
 * Deliberately the exact rule Express uses (`mime.charsets.lookup`): `text/*`
 * plus `application/javascript` and `application/json`, and nothing else. A
 * wider rule was tried and rejected — adding a charset to
 * `application/vnd.api+json` is arguably more correct but produces a different
 * `Content-Type` from Express for the same call, which is the sort of silent
 * divergence the compat surface exists to avoid.
 */
const UTF8_TYPES = /^text\/|^application\/(javascript|json)/i;

/**
 * Does this value contain a character that could split the response?
 *
 * A scan rather than a regex with a literal NUL in it: an invisible control
 * character in source is a hazard of its own. `node:http` rejects these too, so
 * this is belt and braces — but it fails with a message naming the framework
 * method, and it catches values being composed rather than set directly.
 */
function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c === 0x0d /* CR */ || c === 0x0a /* LF */ || c === 0x00 /* NUL */) return true;
  }
  return false;
}

/**
 * Reject a header value that could split the response.
 *
 * @throws when the value contains CR, LF or NUL.
 */
export function assertHeaderValue(
  field: string,
  value: string,
  fn: (...a: never[]) => unknown,
): void {
  if (hasControlCharacter(value)) {
    throw frameworkError(
      `Header ${JSON.stringify(field)} cannot contain CR, LF or NUL`,
      fn,
      ErrorCode.INVALID_ARGUMENT,
    );
  }
}

/**
 * Add `; charset=utf-8` to a content-type that wants one and lacks one.
 *
 * Matches Express, which consults the MIME database's charset for the type;
 * the curated equivalent is "text/* and the structured JSON/XML types".
 */
export function withCharset(value: string): string {
  if (CHARSET_PATTERN.test(value)) return value;
  return UTF8_TYPES.test(value) ? `${value}; charset=utf-8` : value;
}

/**
 * Force `charset=utf-8` onto a content-type, replacing any charset already
 * there.
 *
 * This is Express's `setCharset`, and it fires whenever a **string** body is
 * written — `res.send("hi")` encodes as UTF-8, so it says so. It applies to
 * every type, not just the textual ones: real Express answers
 * `res.type("png"); res.send("...")` with `image/png; charset=utf-8`. Buffer
 * bodies are left alone, because their encoding is the caller's business.
 *
 * Distinct from {@link withCharset}, which only *adds* a charset and only for
 * the types that want one. Both exist in Express and they are not the same
 * rule; the differential test pins each.
 *
 * Parameters are walked with a scanner rather than `split(";")` because a
 * quoted parameter value may legally contain a semicolon (`boundary="a;b"`),
 * and splitting would corrupt it.
 */
export function setCharsetUtf8(value: string): string {
  const semicolon = indexOfUnquoted(value, ";");
  if (semicolon === -1) return `${value}; charset=utf-8`;

  const type = value.slice(0, semicolon);
  const kept: string[] = [];
  let position = semicolon + 1;
  while (position <= value.length) {
    let end = indexOfUnquoted(value, ";", position);
    if (end === -1) end = value.length;
    const parameter = value.slice(position, end);
    position = end + 1;
    if (parameter.trim().length === 0) continue;
    const equals = parameter.indexOf("=");
    const name = (equals === -1 ? parameter : parameter.slice(0, equals)).trim().toLowerCase();
    if (name === "charset") continue; // dropped, then re-added below
    kept.push(parameter.trim());
  }
  return [type, ...kept, "charset=utf-8"].join("; ");
}

/** Index of `char` outside any quoted string, or -1. */
function indexOfUnquoted(value: string, char: string, from = 0): number {
  let quoted = false;
  for (let i = from; i < value.length; i++) {
    const c = value[i];
    if (quoted) {
      if (c === "\\") i++;
      else if (c === '"') quoted = false;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === char) return i;
  }
  return -1;
}

/** Normalize what `res.type()` accepts into a full content-type. */
export function contentTypeFor(value: string, fn: (...a: never[]) => unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw frameworkError("res.type() requires a type or extension", fn, ErrorCode.INVALID_ARGUMENT);
  }
  // Unknown falls back to application/octet-stream, per locked decision 11
  // ("Backs res.type ... Unknown -> application/octet-stream") and per the
  // oracle: real Express resolves through mime's default type and answers
  // `application/octet-stream` for an unrecognised extension.
  //
  // An earlier version threw here, on the reasoning that refusing beats
  // emitting a wrong header. The differential test killed it: that reasoning
  // disagreed with both the spec and the package being compat-tested against,
  // and a compat surface does not get to be opinionated about a case its own
  // spec has already decided.
  return withCharset(resolveType(value) ?? DEFAULT_MIME);
}

/** How `res.append` merges with what is already set. */
export function appendValue(
  previous: string | number | string[] | undefined,
  value: string | readonly string[],
): string | string[] {
  if (previous === undefined) return Array.isArray(value) ? [...value] : (value as string);
  const before = Array.isArray(previous) ? previous : [String(previous)];
  return Array.isArray(value) ? [...before, ...value] : [...before, value as string];
}

/**
 * Percent-encode a URL for a `Location` header without double-encoding.
 *
 * An inlined `encodeurl`: it encodes everything outside the safe set but leaves
 * an existing `%XX` escape alone, so a URL that is already encoded survives a
 * round trip. This is the CRLF defence for `location`/`redirect` — a raw
 * newline becomes `%0A` instead of splitting the response.
 */
const ENCODE_CHARS =
  /(?:[^\x21\x25\x26-\x3B\x3D\x3F-\x5B\x5D\x5F\x61-\x7A\x7E]|%(?:[^0-9A-Fa-f]|[0-9A-Fa-f][^0-9A-Fa-f]|$))+/g;
const LONE_SURROGATE = /(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]|[\uD800-\uDBFF]([^\uDC00-\uDFFF]|$)/g;

export function encodeUrl(url: string): string {
  return String(url).replace(LONE_SURROGATE, "$1�$2").replace(ENCODE_CHARS, encodeURI);
}

/** The `Link` header value for `res.links({ next: "..." })`. */
export function formatLinks(
  previous: string | number | string[] | undefined,
  links: Readonly<Record<string, string>>,
): string {
  const entries = Object.entries(links).map(([rel, url]) => `<${url}>; rel="${rel}"`);
  const existing = previous === undefined ? "" : String(previous);
  return existing.length > 0 ? `${existing}, ${entries.join(", ")}` : entries.join(", ");
}

/**
 * Append a field to `Vary`, case-insensitively and without duplicates.
 *
 * `*` is absorbing: once `Vary: *` is set, nothing else can be added, and
 * adding `*` replaces whatever was there. Getting that wrong produces a header
 * that says "varies on everything, and also on Accept", which is meaningless.
 */
export function varyValue(
  previous: string | number | string[] | undefined,
  fields: readonly string[],
): string {
  const existing =
    previous === undefined
      ? []
      : String(previous)
          .split(",")
          .map((f) => f.trim());
  const nonEmpty = existing.filter((f) => f.length > 0);
  if (nonEmpty.includes("*")) return "*";
  if (fields.includes("*")) return "*";

  const seen = new Set(nonEmpty.map((f) => f.toLowerCase()));
  const out = [...nonEmpty];
  for (const field of fields) {
    const lower = field.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(field);
  }
  return out.join(", ");
}

/** What `res.send` should do with a body, before any headers are touched. */
export type SendPlan =
  | { kind: "json"; value: unknown }
  | { kind: "buffer"; value: Buffer; type: string | undefined }
  | { kind: "string"; value: string; type: string | undefined };

/**
 * Decide how to send `body`, per decision 13.
 *
 * - string -> `text/html` unless a type is already set
 * - Buffer -> `application/octet-stream` unless a type is already set
 * - object, array, null -> delegated to `json`
 * - **number -> throws**, a deliberate deviation: `res.send(404)` reads like
 *   "send this status" and Express silently sends the body `404` instead. The
 *   error points at `sendStatus`.
 */
export function inferSendType(
  body: unknown,
  hasType: boolean,
  fn: (...a: never[]) => unknown,
): SendPlan {
  if (typeof body === "number") {
    throw frameworkError(
      `res.send(${body}) looks like a status code. Use res.sendStatus(${body}) to send a status, ` +
        `or res.json(${body}) to send the number as a body.`,
      fn,
      ErrorCode.INVALID_ARGUMENT,
    );
  }
  if (typeof body === "string") {
    return { kind: "string", value: body, type: hasType ? undefined : "text/html; charset=utf-8" };
  }
  if (Buffer.isBuffer(body)) {
    return { kind: "buffer", value: body, type: hasType ? undefined : "application/octet-stream" };
  }
  return { kind: "json", value: body };
}

/** Status codes whose responses carry no body or entity headers. */
export function isBodyless(status: number): boolean {
  return status === 204 || status === 304 || (status >= 100 && status < 200);
}

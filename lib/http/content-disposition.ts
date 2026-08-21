import { ErrorCode, frameworkError } from "../errors/index.js";

/**
 * `Content-Disposition`, RFC 6266 + RFC 5987.
 *
 * An inlined equivalent of the `content-disposition` package (structure rule 2),
 * because filenames are attacker-controlled in most apps that use them and this
 * header is where a naive implementation leaks a path or breaks out of a quoted
 * string.
 *
 * The rules that a hand-rolled version gets wrong, all of which are enforced
 * below and pinned by a differential test against the real package:
 *
 * - `filename*` is emitted **only when needed** — a plain ASCII name gets the
 *   simple quoted form, not both.
 * - Quotes and backslashes in the name are **escaped**, never stripped.
 *   Deleting them silently corrupts the filename the user asked for.
 * - The ASCII fallback replaces each non-Latin-1 character with `?`, and is
 *   emitted alongside `filename*` so old clients still get something.
 * - RFC 5987's `attr-char` set is narrower than what `encodeURIComponent`
 *   leaves alone: `'`, `(`, `)`, `*`, `,`, `:`, `;`, `<`, `=`, `>`, `?`, `@`,
 *   `[`, `]`, `{`, `}` and `/` all have to be percent-encoded afterwards.
 *   Missing that is what produces a malformed `filename*=UTF-8'''name'`.
 * - A name that already contains a percent escape must still get `filename*`,
 *   or `%20` in a filename would be decoded by the client as a space.
 */

/** Printable ASCII plus Latin-1: what may go in a quoted-string unencoded. */
const TEXT = /^[\x20-\x7e\x80-\xff]+$/;
/** Anything outside Latin-1, replaced by "?" in the ASCII fallback. */
const NON_LATIN1 = /[^\x20-\x7e\xa0-\xff]/g;
/** Already-percent-encoded sequences force the extended form. */
const HEX_ESCAPE = /%[0-9A-Fa-f]{2}/;
/** Characters to escape inside a quoted-string. */
const QUOTE = /([\\"])/g;
/** Not in RFC 5987 attr-char, once encodeURIComponent has run (so not "%"). */
const NON_ATTR_CHAR = /[\x00-\x20"'()*,/:;<=>?@[\\\]{}\x7f]/g;
/** A valid disposition type: an RFC 7230 token. */
const TOKEN = /^[!#$%&'*+.0-9A-Z^_`a-z|~-]+$/;

export interface ContentDispositionOptions {
  /** `attachment` (default) or `inline`. */
  type?: string;
  /**
   * ASCII fallback for clients that do not understand `filename*`.
   * `true` (default) derives one, `false` suppresses it, a string supplies one.
   */
  fallback?: string | boolean;
}

/**
 * Build a `Content-Disposition` header value.
 *
 * @throws when the type is not a token, or a supplied fallback is not Latin-1.
 */
export function contentDisposition(
  filename?: string,
  options: ContentDispositionOptions = {},
): string {
  const type = options.type ?? "attachment";
  if (typeof type !== "string" || !TOKEN.test(type)) {
    throw frameworkError(
      `Content-Disposition type must be a token, received ${JSON.stringify(type)}`,
      contentDisposition,
      ErrorCode.INVALID_ARGUMENT,
    );
  }
  if (filename === undefined) return type;
  if (typeof filename !== "string") {
    throw frameworkError(
      "Content-Disposition filename must be a string",
      contentDisposition,
      ErrorCode.INVALID_ARGUMENT,
    );
  }

  const fallback = options.fallback ?? true;
  if (typeof fallback === "string" && NON_LATIN1.test(fallback)) {
    NON_LATIN1.lastIndex = 0; // the regex is global; do not leak state
    throw frameworkError(
      "Content-Disposition fallback must be an ISO-8859-1 string",
      contentDisposition,
      ErrorCode.INVALID_ARGUMENT,
    );
  }
  NON_LATIN1.lastIndex = 0;

  const name = baseName(filename);
  const quotable = TEXT.test(name);

  const fallbackName =
    typeof fallback === "string" ? baseName(fallback) : fallback ? toLatin1(name) : false;
  const hasFallback = typeof fallbackName === "string" && fallbackName !== name;

  let header = type;
  // Parameters are emitted in sorted order, which puts `filename` before
  // `filename*` — the order RFC 6266 recommends for old-client compatibility.
  if (quotable || hasFallback) {
    header += `; filename=${quoteString(hasFallback ? (fallbackName as string) : name)}`;
  }
  if (hasFallback || !quotable || HEX_ESCAPE.test(name)) {
    header += `; filename*=${extendedValue(name)}`;
  }
  return header;
}

/**
 * The final path segment, treating **both** `/` and `\` as separators on every
 * platform.
 *
 * A deliberate, security-motivated deviation: `path.basename` is
 * platform-dependent, so on POSIX it would leave `..\..\secret.pdf` intact in a
 * header built from user input. Treating backslash as a separator everywhere is
 * deterministic and strictly safer, and differs from Express only for a POSIX
 * filename that legitimately contains a backslash. Noted in the compat table.
 */
function baseName(value: string): string {
  // A drive-letter prefix is a path too: "C:report.pdf" is drive-relative, and
  // Express-on-Windows strips it. Doing it everywhere keeps us deterministic.
  if (value.length >= 2 && value.charCodeAt(1) === 0x3a /* : */) {
    const drive = value.charCodeAt(0) | 0x20;
    if (drive >= 0x61 && drive <= 0x7a) value = value.slice(2);
  }

  let end = value.length;
  // Trailing separators are not part of the name.
  while (end > 0) {
    const code = value.charCodeAt(end - 1);
    if (code !== 0x2f && code !== 0x5c) break;
    end--;
  }
  let start = 0;
  for (let i = end - 1; i >= 0; i--) {
    const code = value.charCodeAt(i);
    if (code === 0x2f || code === 0x5c) {
      start = i + 1;
      break;
    }
  }
  return value.slice(start, end);
}

/** Unicode -> ISO-8859-1, with everything else becoming "?". */
function toLatin1(value: string): string {
  return value.replace(NON_LATIN1, "?");
}

function quoteString(value: string): string {
  return `"${value.replace(QUOTE, "\\$1")}"`;
}

function extendedValue(value: string): string {
  const encoded = encodeURIComponent(value).replace(
    NON_ATTR_CHAR,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `UTF-8''${encoded}`;
}

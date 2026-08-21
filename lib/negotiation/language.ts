import {
  type Spec,
  compareSpecs,
  isQuality,
  isWhitespace,
  matchTail,
  parseQ,
  rankProvided,
  skipWhitespace,
} from "./shared.js";

/**
 * `Accept-Language` negotiation — negotiator's `preferredLanguages`.
 *
 * Specificity: exact tag match (4) beats header-prefix-matches-provided-tag
 * (2: header `en` accepts provided `en-US`) beats provided-prefix-matches-
 * header-tag (1: header `en-US` accepts provided `en`) beats `*` (0).
 */

interface LanguageEntry {
  prefix: string;
  suffix: string | undefined;
  full: string;
  q: number;
  i: number;
}

/** Scan equivalent of `^\s*([^\s\-;]+)(?:-([^\s;]+))?\s*(?:;(.*))?$`. */
function parseLanguage(str: string, i: number): LanguageEntry | null {
  let pos = skipWhitespace(str, 0);
  const start = pos;
  while (pos < str.length) {
    const c = str.charCodeAt(pos);
    if (c === 0x2d /* - */ || c === 0x3b || isWhitespace(c)) break;
    pos++;
  }
  if (pos === start) return null;
  const prefix = str.slice(start, pos);

  let suffix: string | undefined;
  if (pos < str.length && str.charCodeAt(pos) === 0x2d) {
    const sufStart = pos + 1;
    let end = sufStart;
    while (end < str.length) {
      const c = str.charCodeAt(end);
      if (c === 0x3b || isWhitespace(c)) break;
      end++;
    }
    // "en-" with nothing after the dash: the optional group cannot match and
    // the dash is not whitespace, `;` or the end, so the whole regex fails.
    if (end === sufStart) return null;
    suffix = str.slice(sufStart, end);
    pos = end;
  }

  const tail = matchTail(str, pos);
  if (tail === -1) return null;

  let q = 1;
  if (tail < str.length && tail + 1 < str.length) {
    // negotiator: no trim, no break — the LAST q wins here.
    for (const raw of str.slice(tail + 1).split(";")) {
      const p = raw.split("=");
      if (p[0] === "q") q = parseQ(p[1]);
    }
  }
  const full = suffix === undefined ? prefix : `${prefix}-${suffix}`;
  return { prefix, suffix, full, q, i };
}

function specify(language: string, spec: LanguageEntry, index: number): Spec | null {
  const p = parseLanguage(language, -1);
  if (p === null) return null;
  let s = 0;
  if (spec.full.toLowerCase() === p.full.toLowerCase()) s |= 4;
  else if (spec.prefix.toLowerCase() === p.full.toLowerCase()) s |= 2;
  else if (spec.full.toLowerCase() === p.prefix.toLowerCase()) s |= 1;
  else if (spec.full !== "*") return null;
  return { i: index, o: spec.i, q: spec.q, s };
}

function parseAcceptLanguage(accept: string): LanguageEntry[] {
  const pieces = accept.split(",");
  const out: LanguageEntry[] = [];
  for (let i = 0; i < pieces.length; i++) {
    const entry = parseLanguage((pieces[i] as string).trim(), i);
    if (entry !== null) out.push(entry);
  }
  return out;
}

/** Preferred languages. An absent header means `*`; an empty one, nothing. */
export function preferredLanguages(
  accept: string | undefined,
  provided?: readonly string[],
): string[] {
  const accepts = parseAcceptLanguage(accept === undefined ? "*" : accept || "");
  if (provided === undefined) {
    return accepts
      .map((e): Spec & { full: string } => ({ i: e.i, o: e.i, q: e.q, s: 0, full: e.full }))
      .filter(isQuality)
      .sort(compareSpecs)
      .map((e) => e.full);
  }
  return rankProvided(provided, accepts, specify);
}

import {
  type Spec,
  compareSpecs,
  isQuality,
  matchTail,
  parseQ,
  rankProvided,
  skipWhitespace,
  splitQuoted,
  isWhitespace,
} from "./shared.js";

/**
 * `Accept` negotiation — negotiator's `preferredMediaTypes`.
 *
 * The parser is a scan equivalent to `^\s*([^\s\/;]+)\/([^;\s]+)\s*(?:;(.*))?$`
 * followed by negotiator's parameter handling: parameters split on `;`
 * (quote-aware), keys lowercased, a quoted value unwrapped, `q` read with
 * parseFloat and everything after it ignored.
 */

interface MediaEntry {
  type: string;
  subtype: string;
  params: Record<string, string | undefined>;
  q: number;
  i: number;
}

/** Parse one media range. `null` where negotiator's regex would not match. */
export function parseMediaType(str: string, i: number): MediaEntry | null {
  let pos = skipWhitespace(str, 0);
  const typeStart = pos;
  while (pos < str.length) {
    const c = str.charCodeAt(pos);
    if (c === 0x2f /* / */ || c === 0x3b /* ; */ || isWhitespace(c)) break;
    pos++;
  }
  if (pos === typeStart || pos === str.length || str.charCodeAt(pos) !== 0x2f) return null;
  const type = str.slice(typeStart, pos);
  pos++; // the slash

  const subStart = pos;
  while (pos < str.length) {
    const c = str.charCodeAt(pos);
    if (c === 0x3b || isWhitespace(c)) break;
    pos++;
  }
  if (pos === subStart) return null;
  const subtype = str.slice(subStart, pos);

  const tail = matchTail(str, pos);
  if (tail === -1) return null;

  const params: Record<string, string | undefined> = Object.create(null) as Record<
    string,
    string | undefined
  >;
  let q = 1;
  // match[3] is the text after ';'; an empty remainder is falsy for negotiator.
  if (tail < str.length && tail + 1 < str.length) {
    const rest = str.slice(tail + 1);
    for (const raw of splitQuoted(rest, ";")) {
      const pair = raw.trim();
      const eq = pair.indexOf("=");
      const key = (eq === -1 ? pair : pair.slice(0, eq)).toLowerCase();
      const val = eq === -1 ? undefined : pair.slice(eq + 1);
      const value =
        val !== undefined && val.length >= 2 && val.startsWith('"') && val.endsWith('"')
          ? val.slice(1, -1)
          : val;
      if (key === "q") {
        q = parseQ(value);
        break;
      }
      params[key] = value;
    }
  }
  return { type, subtype, params, q, i };
}

function parseAccept(accept: string): MediaEntry[] {
  const out: MediaEntry[] = [];
  const pieces = splitQuoted(accept, ",");
  for (let i = 0; i < pieces.length; i++) {
    const entry = parseMediaType((pieces[i] as string).trim(), i);
    if (entry !== null) out.push(entry);
  }
  return out;
}

/** negotiator's `specify` for media types. */
function specify(type: string, spec: MediaEntry, index: number): Spec | null {
  const p = parseMediaType(type, -1);
  if (p === null) return null;
  let s = 0;
  if (spec.type.toLowerCase() === p.type.toLowerCase()) s |= 4;
  else if (spec.type !== "*") return null;
  if (spec.subtype.toLowerCase() === p.subtype.toLowerCase()) s |= 2;
  else if (spec.subtype !== "*") return null;

  const keys = Object.keys(spec.params);
  if (keys.length > 0) {
    const every = keys.every(
      (k) =>
        spec.params[k] === "*" ||
        (spec.params[k] ?? "").toLowerCase() === (p.params[k] ?? "").toLowerCase(),
    );
    if (every) s |= 1;
    else return null;
  }
  return { i: index, o: spec.i, q: spec.q, s };
}

/**
 * Preferred media types. With no `provided` list, returns the header's types
 * in preference order; with one, the acceptable provided types in order.
 *
 * An absent header means `*\/*` (RFC 9110 §12.5.1); an empty one means nothing.
 */
export function preferredMediaTypes(
  accept: string | undefined,
  provided?: readonly string[],
): string[] {
  const accepts = parseAccept(accept === undefined ? "*/*" : accept || "");
  if (provided === undefined) {
    return accepts
      .map((e): Spec & { full: string } => ({
        i: e.i,
        o: e.i,
        q: e.q,
        s: 0,
        full: `${e.type}/${e.subtype}`,
      }))
      .filter(isQuality)
      .sort(compareSpecs)
      .map((e) => e.full);
  }
  return rankProvided(provided, accepts, specify);
}

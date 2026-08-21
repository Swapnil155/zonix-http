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

/** `Accept-Charset` negotiation — negotiator's `preferredCharsets`. */

interface CharsetEntry {
  charset: string;
  q: number;
  i: number;
}

/** Scan equivalent of `^\s*([^\s;]+)\s*(?:;(.*))?$`. */
function parseCharset(str: string, i: number): CharsetEntry | null {
  let pos = skipWhitespace(str, 0);
  const start = pos;
  while (pos < str.length) {
    const c = str.charCodeAt(pos);
    if (c === 0x3b || isWhitespace(c)) break;
    pos++;
  }
  if (pos === start) return null;
  const charset = str.slice(start, pos);
  const tail = matchTail(str, pos);
  if (tail === -1) return null;

  let q = 1;
  if (tail < str.length && tail + 1 < str.length) {
    for (const raw of str.slice(tail + 1).split(";")) {
      const p = raw.trim().split("=");
      if (p[0] === "q") {
        q = parseQ(p[1]);
        break;
      }
    }
  }
  return { charset, q, i };
}

function specify(charset: string, spec: CharsetEntry, index: number): Spec | null {
  let s = 0;
  if (spec.charset.toLowerCase() === charset.toLowerCase()) s |= 1;
  else if (spec.charset !== "*") return null;
  return { i: index, o: spec.i, q: spec.q, s };
}

function parseAcceptCharset(accept: string): CharsetEntry[] {
  const pieces = accept.split(",");
  const out: CharsetEntry[] = [];
  for (let i = 0; i < pieces.length; i++) {
    const entry = parseCharset((pieces[i] as string).trim(), i);
    if (entry !== null) out.push(entry);
  }
  return out;
}

/** Preferred charsets. An absent header means `*`; an empty one, nothing. */
export function preferredCharsets(
  accept: string | undefined,
  provided?: readonly string[],
): string[] {
  const accepts = parseAcceptCharset(accept === undefined ? "*" : accept || "");
  if (provided === undefined) {
    return accepts
      .map((e): Spec & { full: string } => ({ i: e.i, o: e.i, q: e.q, s: 0, full: e.charset }))
      .filter(isQuality)
      .sort(compareSpecs)
      .map((e) => e.full);
  }
  return rankProvided(provided, accepts, specify);
}

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
 * `Accept-Encoding` negotiation — negotiator's `preferredEncodings`.
 *
 * The identity rules are the part worth reading twice: when `identity` does
 * not appear in the header (and neither does `*`, which matches it), it is
 * appended with the LOWEST quality seen — so `gzip;q=0.5` still allows
 * identity, at 0.5. And `identity;q=0` is how a client forbids it.
 */

interface EncodingEntry {
  encoding: string;
  q: number;
  i: number;
}

/** Scan equivalent of `^\s*([^\s;]+)\s*(?:;(.*))?$`. */
function parseEncoding(str: string, i: number): EncodingEntry | null {
  let pos = skipWhitespace(str, 0);
  const start = pos;
  while (pos < str.length) {
    const c = str.charCodeAt(pos);
    if (c === 0x3b || isWhitespace(c)) break;
    pos++;
  }
  if (pos === start) return null;
  const encoding = str.slice(start, pos);
  const tail = matchTail(str, pos);
  if (tail === -1) return null;

  let q = 1;
  if (tail < str.length && tail + 1 < str.length) {
    // Plain split here — negotiator's encoding parser is not quote-aware.
    for (const raw of str.slice(tail + 1).split(";")) {
      const p = raw.trim().split("=");
      if (p[0] === "q") {
        q = parseQ(p[1]);
        break;
      }
    }
  }
  return { encoding, q, i };
}

function specify(encoding: string, spec: EncodingEntry, index: number): Spec | null {
  let s = 0;
  if (spec.encoding.toLowerCase() === encoding.toLowerCase()) s |= 1;
  else if (spec.encoding !== "*") return null;
  return { i: index, o: spec.i, q: spec.q, s };
}

function parseAcceptEncoding(accept: string): EncodingEntry[] {
  const pieces = accept.split(",");
  const out: EncodingEntry[] = [];
  let hasIdentity = false;
  let minQuality = 1;
  for (let i = 0; i < pieces.length; i++) {
    const entry = parseEncoding((pieces[i] as string).trim(), i);
    if (entry !== null) {
      out.push(entry);
      hasIdentity = hasIdentity || specify("identity", entry, -1) !== null;
      minQuality = Math.min(minQuality, entry.q || 1);
    }
  }
  if (!hasIdentity) {
    out.push({ encoding: "identity", q: minQuality, i: pieces.length });
  }
  return out;
}

/**
 * Preferred encodings. An absent or empty header means only `identity`.
 */
export function preferredEncodings(
  accept: string | undefined,
  provided?: readonly string[],
): string[] {
  const accepts = parseAcceptEncoding(accept ?? "");
  if (provided === undefined) {
    return accepts
      .map((e): Spec & { full: string } => ({ i: e.i, o: e.i, q: e.q, s: 0, full: e.encoding }))
      .filter(isQuality)
      .sort(compareSpecs)
      .map((e) => e.full);
  }
  return rankProvided(provided, accepts, specify);
}

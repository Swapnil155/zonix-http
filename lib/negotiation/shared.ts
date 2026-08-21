/**
 * Primitives shared by the four negotiators.
 *
 * This directory is the inlined equivalent of `negotiator@0.6.3` (structure
 * rule 2), and rule 8 pins it to that package by differential test. So the
 * semantics here are *negotiator's* — including its quirks, which the oracle
 * will not let us "fix": `parseFloat` for q-values (so `q=0.5abc` is 0.5 and
 * `q=` is NaN, which drops the entry), parameter-less `q` handling, and the
 * exact tie-break order.
 *
 * Decision 11: linear parsing only. negotiator uses anchored regexes; every
 * one is reimplemented below as a character scan with identical acceptance.
 */

/** A parsed, ranked entry. Field names follow negotiator so the math reads the same. */
export interface Spec {
  /** Index into the PROVIDED list (or -1 / unused when listing the header). */
  i: number;
  /** Index of the matching header entry (order of appearance). */
  o: number;
  /** Quality. May be NaN — negotiator's parseFloat leaks through on purpose. */
  q: number;
  /** Specificity bits. */
  s: number;
}

/** A header entry's common fields. */
export interface Entry {
  q: number;
  i: number;
}

/** The priority used when nothing in the header matches a provided value. */
export const NO_MATCH: Spec = { o: -1, q: 0, s: 0, i: -1 };

/**
 * Is `c` a JavaScript `\s` character? negotiator's regexes use `\s`, whose
 * set is Unicode whitespace plus line terminators — wider than ASCII space.
 */
export function isWhitespace(c: number): boolean {
  return (
    c === 0x20 ||
    (c >= 0x09 && c <= 0x0d) ||
    c === 0xa0 ||
    c === 0x1680 ||
    (c >= 0x2000 && c <= 0x200a) ||
    c === 0x2028 ||
    c === 0x2029 ||
    c === 0x202f ||
    c === 0x205f ||
    c === 0x3000 ||
    c === 0xfeff
  );
}

/** A JavaScript line terminator — what `.` refuses to match. */
export function isLineTerminator(c: number): boolean {
  return c === 0x0a || c === 0x0d || c === 0x2028 || c === 0x2029;
}

/** Index of the first non-whitespace char at or after `from`. */
export function skipWhitespace(str: string, from: number): number {
  let i = from;
  while (i < str.length && isWhitespace(str.charCodeAt(i))) i++;
  return i;
}

/**
 * Does `str.slice(from)` consist of an optional run of whitespace and then
 * either the end of the string, or a `;` whose remainder contains no line
 * terminator? Returns the index of the `;` or `str.length` for "end", or -1
 * when the regex would not have matched.
 *
 * This is the shared tail of all four negotiator regexes:
 * `\s*(?:;(.*))?$`.
 */
export function matchTail(str: string, from: number): number {
  const at = skipWhitespace(str, from);
  if (at === str.length) return at;
  if (str.charCodeAt(at) !== 0x3b /* ; */) return -1;
  for (let i = at + 1; i < str.length; i++) {
    if (isLineTerminator(str.charCodeAt(i))) return -1;
  }
  return at;
}

/** Count `"` characters — negotiator's quote-balance test for splitting. */
export function quoteCount(str: string): number {
  let count = 0;
  for (let i = 0; i < str.length; i++) if (str.charCodeAt(i) === 0x22) count++;
  return count;
}

/**
 * Split on `sep`, re-joining pieces while the quotes in the accumulated piece
 * are unbalanced. negotiator's `splitMediaTypes` / `splitParameters`.
 */
export function splitQuoted(str: string, sep: string): string[] {
  const parts = str.split(sep);
  const out: string[] = [parts[0] as string];
  for (let i = 1; i < parts.length; i++) {
    const last = out.length - 1;
    if (quoteCount(out[last] as string) % 2 === 0) out.push(parts[i] as string);
    else out[last] += sep + (parts[i] as string);
  }
  return out;
}

/**
 * negotiator's q-value read: `parseFloat` on whatever followed `q=`. An
 * absent value yields NaN, and NaN fails `isQuality`, dropping the entry.
 */
export function parseQ(value: string | undefined): number {
  return Number.parseFloat(value as string);
}

/** negotiator's `isQuality`. NaN > 0 is false, which is the documented drop. */
export function isQuality(spec: { q: number }): boolean {
  return spec.q > 0;
}

/**
 * negotiator's `compareSpecs`, verbatim in spirit: quality, then
 * specificity, then header order, then provided order. NaN differences are
 * falsy and fall through to the next key — deliberately the same.
 */
export function compareSpecs(a: Spec, b: Spec): number {
  return b.q - a.q || b.s - a.s || a.o - b.o || a.i - b.i || 0;
}

/**
 * negotiator's `getXPriority`: the best spec for one provided value, using
 * its exact comparison `(priority.s - spec.s || priority.q - spec.q ||
 * priority.o - spec.o) < 0`.
 */
export function bestPriority<E extends Entry>(
  accepted: readonly E[],
  index: number,
  specify: (entry: E, index: number) => Spec | null,
): Spec {
  let priority: Spec = NO_MATCH;
  for (let i = 0; i < accepted.length; i++) {
    const spec = specify(accepted[i] as E, index);
    if (spec !== null && (priority.s - spec.s || priority.q - spec.q || priority.o - spec.o) < 0) {
      priority = spec;
    }
  }
  return priority;
}

/**
 * The shared "rank the provided list" step: priority per provided value,
 * drop the unacceptable, sort, map back to the provided strings.
 */
export function rankProvided<E extends Entry>(
  provided: readonly string[],
  accepted: readonly E[],
  specify: (value: string, entry: E, index: number) => Spec | null,
): string[] {
  const priorities = provided.map((value, index) =>
    bestPriority(accepted, index, (entry, i) => specify(value, entry, i)),
  );
  return priorities
    .filter(isQuality)
    .sort(compareSpecs)
    .map((priority) => provided[priority.i] as string);
}

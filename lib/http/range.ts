/**
 * Range header parsing, inlined from `range-parser@1.2.1` (Express's
 * `req.range`, and the 206 machinery in `send`). Pinned by differential test.
 *
 * Return values follow the oracle exactly: `-2` when the header is malformed
 * (no `=`), `-1` when it parses but no range is satisfiable, otherwise the
 * satisfiable ranges with the unit on `.type`. Numbers are read with
 * `parseInt`, so `bytes=1abc-5` is `1-5` — that is what Express accepts.
 */

export interface Range {
  start: number;
  end: number;
}

export interface Ranges extends Array<Range> {
  type: string;
}

export interface RangeOptions {
  /** Merge overlapping and adjacent ranges, preserving first-seen order. */
  combine?: boolean;
}

export function parseRange(size: number, str: string, options?: RangeOptions): Ranges | -1 | -2 {
  const index = str.indexOf("=");
  if (index === -1) return -2;

  const ranges = [] as unknown as Ranges;
  ranges.type = str.slice(0, index);

  let from = index + 1;
  while (from <= str.length) {
    let to = str.indexOf(",", from);
    if (to === -1) to = str.length;
    const piece = str.slice(from, to);
    from = to + 1;

    const dash = piece.indexOf("-");
    const first = dash === -1 ? piece : piece.slice(0, dash);
    // Like `split("-")[1]`: undefined when there is no dash, and only the
    // segment up to the next dash when there are several.
    const second =
      dash === -1
        ? undefined
        : piece.indexOf("-", dash + 1) === -1
          ? piece.slice(dash + 1)
          : piece.slice(dash + 1, piece.indexOf("-", dash + 1));

    let start = Number.parseInt(first, 10);
    let end = second === undefined ? NaN : Number.parseInt(second, 10);

    if (Number.isNaN(start)) {
      start = size - end;
      end = size - 1;
    } else if (Number.isNaN(end)) {
      end = size - 1;
    }
    if (end > size - 1) end = size - 1;
    if (Number.isNaN(start) || Number.isNaN(end) || start > end || start < 0) continue;

    ranges.push({ start, end });
  }

  if (ranges.length < 1) return -1;
  return options?.combine ? combineRanges(ranges) : ranges;
}

interface Indexed extends Range {
  index: number;
}

function combineRanges(ranges: Ranges): Ranges {
  const ordered: Indexed[] = ranges
    .map((r, index) => ({ start: r.start, end: r.end, index }))
    .sort((a, b) => a.start - b.start);

  let j = 0;
  for (let i = 1; i < ordered.length; i++) {
    const range = ordered[i] as Indexed;
    const current = ordered[j] as Indexed;
    if (range.start > current.end + 1) {
      ordered[++j] = range;
    } else if (range.end > current.end) {
      current.end = range.end;
      current.index = Math.min(current.index, range.index);
    }
  }
  ordered.length = j + 1;

  const combined = ordered
    .sort((a, b) => a.index - b.index)
    .map((r) => ({ start: r.start, end: r.end })) as unknown as Ranges;
  combined.type = ranges.type;
  return combined;
}

/** `bytes 0-99/1000`, or `bytes * /1000` (no space) for an unsatisfiable request. */
export function contentRange(type: string, size: number, range?: Range): string {
  return `${type} ${range ? `${range.start}-${range.end}` : "*"}/${size}`;
}

/** Does a Range header ask for bytes? (`send`'s `/^ *bytes=/`, as a scan.) */
export function isBytesRange(header: string): boolean {
  let i = 0;
  while (i < header.length && header.charCodeAt(i) === 0x20) i++;
  return header.startsWith("bytes=", i);
}

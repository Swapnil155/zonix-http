import { ErrorCode, frameworkError } from "../errors/index.js";

/**
 * The extended query parser: `qs@6.15.3`'s `parse()` semantics (the version
 * Express 4.22.2 and body-parser 1.20.6 resolve), reimplemented without the
 * package and with decision 10's security posture fixed rather than optional:
 *
 * - keys are attacker-controlled, so every object produced has a **null
 *   prototype**, and any segment that is an own property of `Object.prototype`
 *   (`__proto__`, `constructor`, `hasOwnProperty`, ...) **or `prototype`** is
 *   dropped with its whole key (qs's `allowPrototypes: false`, plus
 *   `prototype`, which qs keeps; Express itself passes `allowPrototypes: true`
 *   and relies on `req.query` being null-prototype - we do not);
 * - `depth` (default 5) bounds bracket nesting: the remainder past it becomes
 *   one literal segment, or, with `strictDepth`, a 400;
 * - `arrayLimit` (default 20) is the sparse-array guard: an index at or past
 *   it makes an object keyed by the index instead of a 20-million-slot array;
 * - `parameterLimit` (default 1000) truncates, or, with `throwOnParameterLimit`,
 *   answers 413.
 *
 * Parsing is linear: one pass to split, one balanced-bracket scan per key
 * (no regular expressions with nested quantifiers - decision 11).
 */
export interface ExtendedQueryOptions {
  depth?: number;
  arrayLimit?: number;
  parameterLimit?: number;
  strictDepth?: boolean;
  throwOnParameterLimit?: boolean;
}

export type QueryValue = string | QueryValue[] | { [key: string]: QueryValue };
export type ParsedQuery = Record<string, QueryValue>;

interface Resolved {
  depth: number;
  arrayLimit: number;
  parameterLimit: number;
  strictDepth: boolean;
  throwOnParameterLimit: boolean;
}

const DEFAULTS: Resolved = {
  depth: 5,
  arrayLimit: 20,
  parameterLimit: 1000,
  strictDepth: false,
  throwOnParameterLimit: false,
};

type Obj = Record<string, unknown>;

/** Objects that stood in for an array past `arrayLimit`, with their highest numeric index. */
const overflow = new WeakMap<object, number>();

const plain = (): Obj => Object.create(null) as Obj;
const own = (obj: object, key: string): boolean => Object.prototype.hasOwnProperty.call(obj, key);
const isObject = (v: unknown): v is object => v !== null && typeof v === "object";

/** A key segment that must never become a property name (decision 10). */
function forbidden(segment: string): boolean {
  return own(Object.prototype, segment) || segment === "prototype";
}

/** `+` → space, then percent-decoding; a malformed escape leaves the string as-is (qs's fallback). */
function decode(str: string): string {
  const spaced = str.indexOf("+") === -1 ? str : str.split("+").join(" ");
  if (spaced.indexOf("%") === -1) return spaced;
  try {
    return decodeURIComponent(spaced);
  } catch {
    return spaced;
  }
}

/** `%5B`/`%5D` (any case) become literal brackets before anything else, as qs does. */
function unescapeBrackets(str: string): string {
  if (str.indexOf("%5") === -1) return str;
  let out = "";
  let start = 0;
  for (let i = 0; i + 2 < str.length; i++) {
    if (str.charCodeAt(i) !== 37 /* % */ || str.charCodeAt(i + 1) !== 53 /* 5 */) continue;
    const c = str.charCodeAt(i + 2) | 0x20; // fold case
    if (c === 0x62 /* b */ || c === 0x64 /* d */) {
      out += str.slice(start, i) + (c === 0x62 ? "[" : "]");
      start = i + 3;
      i += 2;
    }
  }
  return start === 0 ? str : out + str.slice(start);
}

export function parseExtendedQuery(str: string, options?: ExtendedQueryOptions): ParsedQuery {
  const o: Resolved = options === undefined ? DEFAULTS : { ...DEFAULTS, ...options };
  const result = plain();
  if (str.length === 0) return result as ParsedQuery;

  const values = parseValues(str, o);
  for (const key of Object.keys(values)) {
    const parsed = parseKey(key, values[key], o);
    mergeInto(result, parsed, o);
  }
  return compact(result) as ParsedQuery;
}

// --- pass 1: `a[b]=1&c=2` → { "a[b]": "1", c: "2" } ---------------------------

function parseValues(str: string, o: Resolved): Obj {
  const clean = unescapeBrackets(str);
  if (o.throwOnParameterLimit) {
    let count = 1;
    let index = clean.indexOf("&");
    while (index !== -1) {
      if (++count > o.parameterLimit) {
        throw frameworkError(
          `Too many parameters: more than ${o.parameterLimit}`,
          parseExtendedQuery,
          ErrorCode.TOO_MANY_PARAMETERS,
          413,
        );
      }
      index = clean.indexOf("&", index + 1);
    }
  }
  const parts =
    o.parameterLimit === Infinity ? clean.split("&") : clean.split("&", o.parameterLimit);
  const obj = plain();
  for (const part of parts) {
    const bracketEquals = part.indexOf("]=");
    const pos = bracketEquals === -1 ? part.indexOf("=") : bracketEquals + 1;
    let key: string;
    let val: unknown;
    if (pos === -1) {
      key = decode(part);
      val = "";
    } else {
      key = decode(part.slice(0, pos));
      val = decode(part.slice(pos + 1));
    }
    if (own(obj, key)) {
      obj[key] = combine(obj[key], val, o);
    } else {
      obj[key] = val;
    }
  }
  return obj;
}

// --- pass 2: "a[b][c]" → ["a", "[b]", "[c]"], then nested objects -------------

function splitKey(key: string, o: Resolved): string[] | undefined {
  if (o.depth <= 0) return forbidden(key) ? undefined : [key];
  const segments: string[] = [];
  const first = key.indexOf("[");
  const parent = first >= 0 ? key.slice(0, first) : key;
  if (parent.length > 0) {
    if (forbidden(parent)) return undefined;
    segments.push(parent);
  }
  let open = first;
  let collected = 0;
  const n = key.length;
  while (open >= 0 && collected < o.depth) {
    let level = 1;
    let i = open + 1;
    let close = -1;
    while (i < n && close < 0) {
      const c = key.charCodeAt(i);
      if (c === 0x5b) level++;
      else if (c === 0x5d && --level === 0) close = i;
      i++;
    }
    if (close < 0) {
      // Unterminated group: the raw remainder is one literal segment.
      segments.push("[" + key.slice(open) + "]");
      return segments;
    }
    const content = key.slice(open + 1, close);
    if (forbidden(content)) return undefined;
    segments.push(key.slice(open, close + 1));
    collected++;
    open = key.indexOf("[", close + 1);
  }
  if (open >= 0) {
    if (o.strictDepth) {
      throw frameworkError(
        `Query nesting exceeds the depth limit of ${o.depth}`,
        parseExtendedQuery,
        ErrorCode.QUERY_TOO_DEEP,
        400,
      );
    }
    segments.push("[" + key.slice(open) + "]");
  }
  return segments;
}

function parseKey(key: string, val: unknown, o: Resolved): unknown {
  if (key.length === 0) return undefined;
  const chain = splitKey(key, o);
  if (chain === undefined) return undefined;
  let leaf: unknown = val;
  for (let i = chain.length - 1; i >= 0; i--) {
    const root = chain[i] as string;
    let obj: unknown;
    if (root === "[]") {
      obj = overflow.has(leaf as object) ? leaf : combine([], leaf, o);
    } else {
      const inner =
        root.charCodeAt(0) === 0x5b && root.charCodeAt(root.length - 1) === 0x5d
          ? root.slice(1, -1)
          : root;
      const index = parseInt(inner, 10);
      const isIndex =
        !Number.isNaN(index) && root !== inner && String(index) === inner && index >= 0;
      if (isIndex && index < o.arrayLimit) {
        const arr: unknown[] = [];
        arr[index] = leaf;
        obj = arr;
      } else if (isIndex) {
        const o2 = plain();
        o2[String(index)] = leaf;
        overflow.set(o2, index);
        obj = o2;
      } else {
        const o2 = plain();
        if (inner !== "__proto__") o2[inner] = leaf;
        obj = o2;
      }
    }
    leaf = obj;
  }
  return leaf;
}

// --- qs utils: combine / merge / compact, with the overflow side-channel -----

function arrayToObject(source: unknown[]): Obj {
  const obj = plain();
  for (let i = 0; i < source.length; i++) {
    if (source[i] !== undefined) obj[String(i)] = source[i];
  }
  return obj;
}

function combine(a: unknown, b: unknown, o: Resolved): unknown {
  if (isObject(a) && overflow.has(a)) {
    const next = (overflow.get(a) as number) + 1;
    (a as Obj)[String(next)] = b;
    overflow.set(a, next);
    return a;
  }
  const result = ([] as unknown[]).concat(a as never, b as never);
  if (result.length > o.arrayLimit) {
    const obj = arrayToObject(result);
    overflow.set(obj, result.length - 1);
    return obj;
  }
  return result;
}

function mergeInto(target: Obj, source: unknown, o: Resolved): void {
  if (!isObject(source)) return; // a dropped key, or nothing to add
  mergeObjects(target, source as Obj, o);
}

function merge(target: unknown, source: unknown, o: Resolved): unknown {
  if (!source) return target;

  if (typeof source !== "object") {
    if (Array.isArray(target)) {
      const nextIndex = target.length;
      if (nextIndex >= o.arrayLimit) {
        const obj = arrayToObject(target.concat(source));
        overflow.set(obj, nextIndex);
        return obj;
      }
      target[nextIndex] = source;
    } else if (isObject(target)) {
      if (overflow.has(target)) {
        const newIndex = (overflow.get(target) as number) + 1;
        (target as Obj)[String(newIndex)] = source;
        overflow.set(target, newIndex);
      } else {
        return [target, source]; // strictMerge
      }
    } else {
      return [target, source];
    }
    return target;
  }

  if (!isObject(target)) {
    if (overflow.has(source)) {
      const result = plain();
      result["0"] = target;
      for (const key of Object.keys(source)) {
        result[String(parseInt(key, 10) + 1)] = (source as Obj)[key];
      }
      overflow.set(result, (overflow.get(source) as number) + 1);
      return result;
    }
    const combined = [target].concat(source as never);
    if (combined.length > o.arrayLimit) {
      const obj = arrayToObject(combined);
      overflow.set(obj, combined.length - 1);
      return obj;
    }
    return combined;
  }

  if (Array.isArray(target) && Array.isArray(source)) {
    source.forEach((item, i) => {
      if (own(target, String(i))) {
        const targetItem = target[i];
        if (isObject(targetItem) && isObject(item)) {
          target[i] = merge(targetItem, item, o);
        } else {
          target[target.length] = item;
        }
      } else {
        target[i] = item;
      }
    });
    if (target.length > o.arrayLimit) {
      const obj = arrayToObject(target);
      overflow.set(obj, target.length - 1);
      return obj;
    }
    return target;
  }

  const mergeTarget: Obj = Array.isArray(target) ? arrayToObject(target) : (target as Obj);
  return mergeObjects(mergeTarget, source as Obj, o);
}

function mergeObjects(acc: Obj, source: Obj, o: Resolved): Obj {
  const sourceOverflow = overflow.has(source);
  for (const key of Object.keys(source)) {
    if (forbidden(key)) continue;
    const value = source[key];
    acc[key] = own(acc, key) ? merge(acc[key], value, o) : value;
    if (sourceOverflow && !overflow.has(acc)) overflow.set(acc, overflow.get(source) as number);
    if (overflow.has(acc)) {
      const keyNum = parseInt(key, 10);
      if (String(keyNum) === key && keyNum >= 0 && keyNum > (overflow.get(acc) as number)) {
        overflow.set(acc, keyNum);
      }
    }
  }
  return acc;
}

/** Drop the holes sparse indices left in arrays, recursively (qs's `compact`). */
function compact(value: Obj): Obj {
  const seen = new Set<object>();
  const queue: Array<{ obj: Obj | unknown[]; prop: string }> = [];
  const visit = (obj: object): void => {
    for (const key of Object.keys(obj)) {
      const val = (obj as Obj)[key];
      if (isObject(val) && !seen.has(val)) {
        seen.add(val);
        queue.push({ obj: obj as Obj, prop: key });
        visit(val);
      }
    }
  };
  visit(value);
  for (let i = queue.length - 1; i >= 0; i--) {
    const item = queue[i] as { obj: Obj; prop: string };
    const obj = item.obj[item.prop];
    if (Array.isArray(obj)) item.obj[item.prop] = obj.filter((v) => v !== undefined);
  }
  return value;
}

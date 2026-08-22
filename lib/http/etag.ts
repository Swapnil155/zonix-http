/**
 * Entity tags, inlined from `etag@1.8.1` — the generator Express 4.22.2 uses for
 * `res.send` (via `app.set("etag fn")`) and that `send` uses for files.
 * Pinned by differential test; the formats are the oracle's, byte for byte.
 *
 * - Strings and Buffers: `"<byte length hex>-<sha1 base64, 27 chars>"`;
 *   the empty entity is the fixed `"0-2jmj7l5rSw0yVb/vlWAYkK/YBwk"`.
 * - `fs.Stats` (or anything stat-shaped): `"<size hex>-<mtime ms hex>"`,
 *   weak by default — a stat tag describes the file, not its bytes.
 * - `W/` prefix when weak. Strong is the default for entities.
 */
import { createHash } from "node:crypto";
import { Stats } from "node:fs";

export interface EtagOptions {
  /** Emit a weak validator (`W/"..."`). Defaults to `false` for entities, `true` for stats. */
  weak?: boolean;
}

/** The subset of `fs.Stats` a stat tag needs. */
export interface StatLike {
  mtime: Date;
  size: number;
}

export const EMPTY_ENTITY_TAG = '"0-2jmj7l5rSw0yVb/vlWAYkK/YBwk"';

/** Tag for a body held in memory. */
export function entityTag(entity: string | Buffer): string {
  if (entity.length === 0) return EMPTY_ENTITY_TAG;
  const hasher = createHash("sha1");
  if (typeof entity === "string") hasher.update(entity, "utf8");
  else hasher.update(entity);
  const hash = hasher.digest("base64").substring(0, 27);
  const len = typeof entity === "string" ? Buffer.byteLength(entity, "utf8") : entity.length;
  return `"${len.toString(16)}-${hash}"`;
}

/** Tag for a file, from its stat: size and mtime, never the bytes. */
export function statTag(stat: StatLike): string {
  return `"${stat.size.toString(16)}-${stat.mtime.getTime().toString(16)}"`;
}

/**
 * `computeEtag(entity, options)` - the oracle's `etag()` with its exact dispatch: real `fs.Stats`
 * or a stat-shaped object (`ctime`/`mtime` Dates, numeric `ino` and `size`)
 * gets a weak stat tag; a string or Buffer gets a strong entity tag; anything
 * else is a `TypeError`, as in the original.
 */
export function computeEtag(entity: string | Buffer | StatLike, options?: EtagOptions): string {
  if (entity == null) throw new TypeError("argument entity is required");
  const stats = isStats(entity);
  const weak = options && typeof options.weak === "boolean" ? options.weak : stats;
  if (!stats && typeof entity !== "string" && !Buffer.isBuffer(entity)) {
    throw new TypeError("argument entity must be string, Buffer, or fs.Stats");
  }
  const tag = stats ? statTag(entity as StatLike) : entityTag(entity as string | Buffer);
  return weak ? "W/" + tag : tag;
}

function isStats(obj: unknown): obj is StatLike {
  if (obj instanceof Stats) return true;
  if (obj === null || typeof obj !== "object") return false;
  const o = obj as Record<string, unknown>;
  return (
    "ctime" in o &&
    Object.prototype.toString.call(o["ctime"]) === "[object Date]" &&
    "mtime" in o &&
    Object.prototype.toString.call(o["mtime"]) === "[object Date]" &&
    "ino" in o &&
    typeof o["ino"] === "number" &&
    "size" in o &&
    typeof o["size"] === "number"
  );
}

/** Turn the `etag` app option into a generator, or undefined when off. */
export function compileEtag(
  option: boolean | "weak" | "strong" | ((body: Buffer) => string | undefined) | undefined,
): ((body: Buffer) => string | undefined) | undefined {
  if (option === undefined || option === false) return undefined;
  if (typeof option === "function") return option;
  if (option === "strong") return (body) => entityTag(body);
  return (body) => "W/" + entityTag(body);
}

import type { Stats } from "node:fs";

/** One cached file: the raw bytes as read, the stat they were read under, and the stat tag. */
export interface CachedFile {
  body: Buffer;
  stats: Stats;
  /** `statTag(stats)` without the `W/` prefix, computed once at insert. */
  tag: string;
}

/**
 * A byte-capped LRU of raw file bodies for `serveStatic({ cache })`.
 *
 * Accounting counts body bytes only. `get` refreshes recency (a `Map` keeps
 * insertion order, so delete + re-insert is the whole LRU); `set` evicts from
 * the least recently used end until the new entry fits, and refuses an entry
 * larger than the cap outright. Nothing here touches the filesystem: the
 * caller revalidates an entry against a fresh `stat()` and evicts on change.
 */
export class FileCache {
  readonly maxBytes: number;
  #entries = new Map<string, CachedFile>();
  #bytes = 0;

  constructor(maxBytes: number) {
    this.maxBytes = maxBytes;
  }

  /** Bytes currently held (bodies only). */
  get bytes(): number {
    return this.#bytes;
  }

  /** Number of cached files. */
  get size(): number {
    return this.#entries.size;
  }

  /** Look a file up and mark it most recently used. */
  get(key: string): CachedFile | undefined {
    const entry = this.#entries.get(key);
    if (entry === undefined) return undefined;
    this.#entries.delete(key);
    this.#entries.set(key, entry);
    return entry;
  }

  /** Insert (replacing any existing entry). Returns `false` if the body alone exceeds the cap. */
  set(key: string, entry: CachedFile): boolean {
    const length = entry.body.byteLength;
    if (length > this.maxBytes) {
      this.delete(key);
      return false;
    }
    this.delete(key);
    for (const [oldest, old] of this.#entries) {
      if (this.#bytes + length <= this.maxBytes) break;
      this.#entries.delete(oldest);
      this.#bytes -= old.body.byteLength;
    }
    this.#entries.set(key, entry);
    this.#bytes += length;
    return true;
  }

  delete(key: string): boolean {
    const entry = this.#entries.get(key);
    if (entry === undefined) return false;
    this.#entries.delete(key);
    this.#bytes -= entry.body.byteLength;
    return true;
  }

  clear(): void {
    this.#entries.clear();
    this.#bytes = 0;
  }

  /** Stale when the file's mtime or size no longer match what was cached. */
  static isCurrent(entry: CachedFile, stats: Stats): boolean {
    return entry.stats.mtimeMs === stats.mtimeMs && entry.stats.size === stats.size;
  }
}

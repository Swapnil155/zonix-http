// Files the sendFile scenarios serve. Generated rather than committed so the
// repo stays small; every server reads the same two files.
//
// STATIC_ROOT mirrors the bench routes as paths (`file/small`, `file/large`)
// so the zonix cache-on variant can serve the very same bytes through
// `serveStatic({ cache })`. Every fixture gets one fixed mtime so
// Last-Modified is identical across variants (byte-smoke compares headers).
import { mkdirSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL("./.fixtures/", import.meta.url));

export const SMALL = dir + "small.txt";
export const LARGE = dir + "large.txt";
export const STATIC_ROOT = dir + "static";

const MTIME = new Date("2026-01-01T00:00:00Z");
const SIZES = [
  [SMALL, 1024],
  [LARGE, 1024 * 1024],
  [STATIC_ROOT + "/file/small", 1024],
  [STATIC_ROOT + "/file/large", 1024 * 1024],
];

export function ensureFixtures() {
  mkdirSync(STATIC_ROOT + "/file", { recursive: true });
  for (const [path, size] of SIZES) {
    let ok = false;
    try {
      const st = statSync(path);
      ok = st.size === size && st.mtime.getTime() === MTIME.getTime();
    } catch {
      ok = false;
    }
    if (!ok) {
      writeFileSync(path, Buffer.alloc(size, "x"));
      utimesSync(path, MTIME, MTIME);
    }
  }
  return { SMALL, LARGE, STATIC_ROOT };
}

// Files the sendFile scenarios serve. Generated rather than committed so the
// repo stays small; every server reads the same two files.
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL("./.fixtures/", import.meta.url));

export const SMALL = dir + "small.txt";
export const LARGE = dir + "large.txt";

const SIZES = [
  [SMALL, 1024],
  [LARGE, 1024 * 1024],
];

export function ensureFixtures() {
  mkdirSync(dir, { recursive: true });
  for (const [path, size] of SIZES) {
    let ok = false;
    try {
      ok = statSync(path).size === size;
    } catch {
      ok = false;
    }
    if (!ok) writeFileSync(path, Buffer.alloc(size, "x"));
  }
  return { SMALL, LARGE };
}

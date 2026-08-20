// Enumerate the test files ourselves and hand them to node --test.
//
// Node 22 accepts a glob, Node 20 does not, and npm scripts run through cmd.exe
// on Windows where the shell will not expand one either. Walking the tree here
// keeps `npm test` identical on both supported versions, with no dependency.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

/** Every *.test.ts and *.fuzz.ts under test/, at any depth. */
function collect(dir) {
  const found = [];
  for (const entry of readdirSync(root + dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name === "fixtures") continue;
      found.push(...collect(`${dir}/${entry.name}`));
    } else if (entry.name.endsWith(".test.ts") || entry.name.endsWith(".fuzz.ts")) {
      found.push(`${dir}/${entry.name}`);
    }
  }
  return found;
}

const files = collect("test").sort();
if (files.length === 0) {
  console.error("No test files found under test/");
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  ["--import", "tsx", "--test", ...process.argv.slice(2), ...files],
  { stdio: "inherit", cwd: root },
);

process.exit(result.status ?? 1);

// Enumerate the test files ourselves and hand them to node --test.
//
// Node 22 accepts a glob, Node 20 does not, and npm scripts run through cmd.exe
// on Windows where the shell will not expand one either. Listing the files here
// keeps `npm test` identical on both supported versions, with no dependency.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const testDir = fileURLToPath(new URL("../test/", import.meta.url));
const files = readdirSync(testDir)
  .filter((name) => name.endsWith(".test.ts"))
  .sort()
  .map((name) => `test/${name}`);

if (files.length === 0) {
  console.error("No test files found in test/");
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  ["--import", "tsx", "--test", ...process.argv.slice(2), ...files],
  { stdio: "inherit", cwd: fileURLToPath(new URL("..", import.meta.url)) },
);

process.exit(result.status ?? 1);

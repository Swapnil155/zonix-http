// Freeze the current build AND the current lib/ sources as the A/B baseline.
//   bench/.baseline-build/index.js  -> used by bench/ab.mjs (end-to-end)
//   bench/.baseline-src/*           -> used by bench/micro.ts (in-process A/B)
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const buildDir = fileURLToPath(new URL("./.baseline-build/", import.meta.url));
const srcDir = fileURLToPath(new URL("./.baseline-src/", import.meta.url));

rmSync(buildDir, { recursive: true, force: true });
mkdirSync(buildDir, { recursive: true });
cpSync(fileURLToPath(new URL("../dist/index.js", import.meta.url)), buildDir + "index.js");

rmSync(srcDir, { recursive: true, force: true });
cpSync(fileURLToPath(new URL("../lib/", import.meta.url)), srcDir, { recursive: true });

console.log("baseline frozen:");
console.log(`  build -> ${buildDir}index.js`);
console.log(`  src   -> ${srcDir}`);

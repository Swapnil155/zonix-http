// M3 — footprint & cold start: the zero-dependency dividend, measured.
//
// Three numbers per framework, all from CLEAN installs in bench/.m3/ (never
// from the shared dev node_modules, which would understate everyone):
//
//   1. Install size: bytes, files, and package count of node_modules after
//      `npm install <framework>` with nothing else. zonix installs from its
//      own `npm pack` tarball — exactly what a user would receive.
//   2. Cold import: median of 10 fresh-process runs, measuring the
//      import()/require() duration in-process (node boot excluded, so the
//      number is the framework's, not the runtime's).
//   3. RSS after 10k requests: a minimal hello app per framework, 10k
//      keep-alive requests, then RSS — raw, and after gc() (--expose-gc) so
//      retained memory is separated from garbage not yet collected.
//
// These are production metrics (serverless cold starts, container layers,
// supply-chain surface), and per M3 the numbers are published honestly even
// where the margin is small.
//
// Run:  node bench/startup.mjs           (reuses installs in bench/.m3/)
//       node bench/startup.mjs --fresh   (reinstalls from scratch)
import { execSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { measureCpu, reportCpu } from "./regime.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const M3 = join(ROOT, "bench", ".m3");
const FRESH = process.argv.includes("--fresh");

// Pinned to the versions every recorded bench matrix used.
const EXPRESS_SPEC = "express@4.22.2";
const FASTIFY_SPEC = "fastify@5.12.1";

const sh = (cmd, cwd) => execSync(cmd, { cwd, stdio: "pipe", shell: true }).toString();

// --- 1. clean installs -------------------------------------------------------

function installDir(name) {
  const dir = join(M3, name);
  mkdirSync(dir, { recursive: true });
  if (!existsSync(join(dir, "package.json"))) {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: `m3-${name}`, private: true }));
  }
  return dir;
}

function ensureInstalls() {
  if (FRESH && existsSync(M3)) rmSync(M3, { recursive: true, force: true });
  mkdirSync(M3, { recursive: true });

  // zonix: pack the repo (files: ["dist"]) and install the tarball.
  const zonixDir = installDir("zonix");
  if (!existsSync(join(zonixDir, "node_modules", "zonix"))) {
    console.log("packing zonix...");
    const tarball = sh(`npm pack --pack-destination "${M3}"`, ROOT).trim().split(/\r?\n/).pop();
    console.log("installing zonix from tarball...");
    sh(`npm install --no-save --no-audit --no-fund "${join(M3, tarball)}"`, zonixDir);
  }

  for (const [name, spec] of [
    ["express", EXPRESS_SPEC],
    ["fastify", FASTIFY_SPEC],
  ]) {
    const dir = installDir(name);
    if (!existsSync(join(dir, "node_modules", name))) {
      console.log(`installing ${spec}...`);
      sh(`npm install --no-save --no-audit --no-fund --prefer-offline ${spec}`, dir);
    }
  }
}

/** Recursive walk: total bytes, file count, and package count. */
function measureTree(dir) {
  let bytes = 0;
  let files = 0;
  let packages = 0;
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) {
        if (existsSync(join(full, "package.json"))) packages++;
        walk(full);
      } else if (entry.isFile()) {
        files++;
        bytes += statSync(full).size;
      }
    }
  };
  walk(dir);
  return { bytes, files, packages };
}

// --- 2. cold import ----------------------------------------------------------

/**
 * One fresh process: import the framework, print the duration. The child code
 * loads from the CLEAN install, so resolution cost is a user's, not our
 * dev tree's.
 */
function coldImportCode(name) {
  const dir = join(M3, name);
  if (name === "zonix") {
    const entry = pathToFileURL(join(dir, "node_modules", "zonix", "dist", "index.js")).href;
    return `
      const t0 = performance.now();
      await import(${JSON.stringify(entry)});
      console.log(JSON.stringify({ ms: performance.now() - t0 }));
    `;
  }
  return `
    import { createRequire } from "node:module";
    const require = createRequire(${JSON.stringify(pathToFileURL(join(dir, "x.js")).href)});
    const t0 = performance.now();
    require(${JSON.stringify(name)});
    console.log(JSON.stringify({ ms: performance.now() - t0 }));
  `;
}

function runChild(code, extraArgs = []) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [...extraArgs, "--input-type=module", "-e", code], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    proc.stdout.on("data", (d) => (out += d));
    proc.stderr.on("data", (d) => (err += d));
    proc.on("exit", (codeNum) =>
      codeNum === 0 ? resolve(out) : reject(new Error(`child exited ${codeNum}: ${err}`)),
    );
  });
}

async function coldImport(name, runs = 10) {
  const times = [];
  for (let i = 0; i < runs; i++) {
    const out = await runChild(coldImportCode(name));
    times.push(JSON.parse(out.trim()).ms);
  }
  times.sort((a, b) => a - b);
  return { median: times[Math.floor(runs / 2)], min: times[0], max: times[runs - 1] };
}

// --- 3. RSS after 10k requests ----------------------------------------------

/** A minimal hello server per framework, with an RSS endpoint. */
function serverCode(name) {
  const dir = join(M3, name);
  // Shared measurement function, injected into every server verbatim.
  const rssFn = `
    const rssNow = () => {
      const raw = process.memoryUsage().rss;
      if (globalThis.gc) globalThis.gc();
      return { raw, afterGc: process.memoryUsage().rss };
    };
  `;
  if (name === "zonix") {
    const entry = pathToFileURL(join(dir, "node_modules", "zonix", "dist", "index.js")).href;
    return `
      ${rssFn}
      const { default: zonix } = await import(${JSON.stringify(entry)});
      const app = zonix({ dev: false });
      app.get("/", (req, res) => res.json({ hello: "world" }));
      app.get("/__rss", (req, res) => res.json(rssNow()));
      app.listen(0, () => console.log("PORT " + app.address().port));
    `;
  }
  if (name === "express") {
    return `
      ${rssFn}
      import { createRequire } from "node:module";
      const require = createRequire(${JSON.stringify(pathToFileURL(join(dir, "x.js")).href)});
      const express = require("express");
      const app = express();
      app.get("/", (req, res) => res.json({ hello: "world" }));
      app.get("/__rss", (req, res) => res.json(rssNow()));
      const server = app.listen(0, () => console.log("PORT " + server.address().port));
    `;
  }
  return `
    ${rssFn}
    import { createRequire } from "node:module";
    const require = createRequire(${JSON.stringify(pathToFileURL(join(dir, "x.js")).href)});
    const fastify = require("fastify")({ logger: false });
    fastify.get("/", (req, reply) => reply.send({ hello: "world" }));
    fastify.get("/__rss", (req, reply) => reply.send(rssNow()));
    fastify.listen({ port: 0, host: "127.0.0.1" }).then((addr) =>
      console.log("PORT " + new URL(addr).port));
  `;
}

async function rssAfterLoad(name, total = 10_000, concurrency = 20) {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      process.execPath,
      ["--expose-gc", "--input-type=module", "-e", serverCode(name)],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let err = "";
    proc.stderr.on("data", (d) => (err += d));
    proc.on("exit", (code) => {
      if (code !== null && code !== 0) reject(new Error(`server exited ${code}: ${err}`));
    });
    proc.stdout.on("data", async (d) => {
      const match = String(d).match(/PORT (\d+)/);
      if (!match) return;
      const base = `http://127.0.0.1:${match[1]}`;
      try {
        const per = Math.ceil(total / concurrency);
        await Promise.all(
          Array.from({ length: concurrency }, async () => {
            for (let i = 0; i < per; i++) await fetch(`${base}/`).then((r) => r.arrayBuffer());
          }),
        );
        const rss = await (await fetch(`${base}/__rss`)).json();
        resolve(rss);
      } catch (e) {
        reject(e);
      } finally {
        proc.kill();
      }
    });
  });
}

// --- report ------------------------------------------------------------------

const fmtBytes = (n) =>
  n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(2)} MB` : `${(n / 1024).toFixed(1)} KB`;
const fmtMs = (n) => `${n.toFixed(1)} ms`;
const fmt = (n) => Math.round(n).toLocaleString("en-US");

reportCpu(await measureCpu({ sampleMs: 500 }));
console.log(`node ${process.version}\n`);
ensureInstalls();

const rows = [];
for (const name of ["zonix", "express", "fastify"]) {
  process.stdout.write(`measuring ${name}...`);
  const install = measureTree(join(M3, name, "node_modules"));
  const imp = await coldImport(name);
  const rss = await rssAfterLoad(name);
  rows.push({ name, install, imp, rss });
  console.log(" done");
}
console.log("");

console.log(
  "| framework | install size | files | packages | cold import (median of 10) | RSS after 10k req | RSS after gc |",
);
console.log(
  "| --------- | -----------: | ----: | -------: | -------------------------: | ----------------: | -----------: |",
);
for (const r of rows) {
  console.log(
    `| ${r.name.padEnd(9)} | ${fmtBytes(r.install.bytes)} | ${fmt(r.install.files)} | ` +
      `${fmt(r.install.packages)} | ${fmtMs(r.imp.median)} (${fmtMs(r.imp.min)}–${fmtMs(r.imp.max)}) | ` +
      `${fmtBytes(r.rss.raw)} | ${fmtBytes(r.rss.afterGc)} |`,
  );
}

const z = rows[0];
console.log("\nmargins vs zonix:");
for (const r of rows.slice(1)) {
  console.log(
    `  ${r.name}: install ${(r.install.bytes / z.install.bytes).toFixed(1)}x bytes, ` +
      `${(r.install.files / z.install.files).toFixed(1)}x files, ` +
      `${r.install.packages}x packages (zonix: ${z.install.packages}), ` +
      `cold import ${(r.imp.median / z.imp.median).toFixed(1)}x, ` +
      `RSS(gc) ${(r.rss.afterGc / z.rss.afterGc).toFixed(2)}x`,
  );
}

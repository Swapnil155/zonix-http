// D8 runner: build the pinned bench image and run a bench command inside it.
//
//   node bench/container.mjs                      # build + default (run.mjs)
//   node bench/container.mjs -- node bench/interleave.mjs --scenario=file-1kb --rounds=5
//   node bench/container.mjs --cpus=8 -- node upstream/fastify-cliff/repro.mjs 6 200
//   node bench/container.mjs --no-build -- ...    # reuse the last image
//
// What it pins, and why each pin exists:
//   - the image is built from the repo COPIED in (see bench/Dockerfile) -
//     never a bind mount from C:\; that is D8's one hard rule;
//   - --cpus is pinned (default 8) so runs are comparable to each other;
//   - the container runs the regime probe + fingerprint on entry, so every
//     transcript starts with the context it was measured in;
//   - BUSY-MACHINE discipline still applies: the VM shares the host's physical
//     cores, so the HOST cpu preflight runs here before docker starts.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { measureCpu, reportCpu } from "./regime.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const IMAGE = "zonix-bench";

const argv = process.argv.slice(2);
const dash = argv.indexOf("--");
const flags = dash === -1 ? argv : argv.slice(0, dash);
const command = dash === -1 ? [] : argv.slice(dash + 1);

const opt = (name, fallback) => {
  const hit = flags.find((f) => f.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const cpus = opt("cpus", "8");
const build = !flags.includes("--no-build");

// No shell: with shell:true on win32 a quoted `node -e "..."` argument is
// re-split by cmd.exe and arrives at docker in pieces. Spawning docker.exe
// directly passes every argument intact.
const DOCKER = process.platform === "win32" ? "docker.exe" : "docker";

function sh(args, { inherit = true } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(args[0] === "docker" ? DOCKER : args[0], args.slice(1), {
      cwd: ROOT,
      stdio: inherit ? "inherit" : ["ignore", "pipe", "inherit"],
    });
    let out = "";
    child.stdout?.on("data", (d) => (out += d));
    child.on("exit", (code) =>
      code === 0 ? resolve(out) : reject(new Error(`${args[0]} exited ${code}`)),
    );
    child.on("error", reject);
  });
}

// Host preflight: the VM borrows these cores.
const cpu = await measureCpu({ sampleMs: 700 });
reportCpu(cpu);
console.log("");
// --abort-busy: a matrix that must be comparable refuses to start on a busy host.
if (cpu.busy && flags.includes("--abort-busy")) {
  console.log("BUSY-MACHINE: aborting before docker starts (--abort-busy).");
  process.exit(2);
}

if (build) {
  console.log(`building ${IMAGE} (repo copied in, never mounted)...`);
  await sh(["docker", "build", "-t", IMAGE, "-f", "bench/Dockerfile", "."]);
  console.log("");
}

const run = [
  "docker",
  "run",
  "--rm",
  `--cpus=${cpus}`,
  // Fixtures and probes write inside the container's own ext4 layer.
  "-e",
  `BENCH_CONTAINER_CPUS=${cpus}`,
  IMAGE,
  ...command,
];
console.log(`> ${run.join(" ")}\n`);
await sh(run);

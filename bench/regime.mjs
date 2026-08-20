// Rule 7: regime preflight.
//
// BI-1 found a filesystem filter driver (AV real-time scanning) throttling
// open() system-wide to ~3.4-3.9k/sec (~260us each) while reads on an already
// open fd ran 170x faster. Every framework opens once per request, so all of
// them pin at that ceiling — and a mid-run regime flip charges the change to
// whichever framework benched later, which is exactly how the session-3 matrix
// produced a fake 5.4x win.
//
// So: before any file scenario, measure raw open() throughput on the actual
// bench fixture and stamp the result. Below the threshold the numbers describe
// the filter driver, not the framework, and no absolute or cross-framework
// claim may be built on them.
import { closeSync, openSync, readFileSync, readSync } from "node:fs";
import { cpus as osCpus } from "node:os";

/** Opens/sec below which the machine is considered degraded (CLAUDE.md rule 7). */
export const REGIME_THRESHOLD_OPS = 50_000;

/**
 * Measure `open` + `read` + `close` throughput on `path`, plus the rate of
 * reads through an already-open descriptor.
 *
 * The second number is the tell: when open() is being intercepted the two
 * diverge by orders of magnitude, which distinguishes a filter driver from a
 * merely slow disk (a slow disk makes both slow).
 */
export function measureRegime(path, { iterations = 2000 } = {}) {
  for (let i = 0; i < 200; i++) readFileSync(path); // warm the page cache

  const openStart = process.hrtime.bigint();
  for (let i = 0; i < iterations; i++) readFileSync(path);
  const openNs = Number(process.hrtime.bigint() - openStart);
  const opensPerSec = (iterations / openNs) * 1e9;

  const fd = openSync(path, "r");
  const buffer = Buffer.alloc(4096);
  const readIterations = iterations * 10;
  const readStart = process.hrtime.bigint();
  for (let i = 0; i < readIterations; i++) readSync(fd, buffer, 0, buffer.length, 0);
  const readNs = Number(process.hrtime.bigint() - readStart);
  closeSync(fd);
  const readsPerSec = (readIterations / readNs) * 1e9;

  const degraded = opensPerSec < REGIME_THRESHOLD_OPS;
  return {
    opensPerSec,
    readsPerSec,
    ratio: readsPerSec / opensPerSec,
    degraded,
    stamp: degraded ? "DEGRADED-REGIME" : "OK",
    threshold: REGIME_THRESHOLD_OPS,
  };
}

const fmt = (n) => Math.round(n).toLocaleString("en-US");

/** One-line summary for harness output and for pasting into results.md. */
export function formatRegime(regime) {
  return (
    `regime: ${regime.stamp} — ${fmt(regime.opensPerSec)} opens/sec ` +
    `(threshold ${fmt(regime.threshold)}), ${fmt(regime.readsPerSec)} reads/sec on an open fd ` +
    `(${regime.ratio.toFixed(0)}x)`
  );
}

/** Print the preflight and, when degraded, say plainly what may not be claimed. */
export function reportRegime(regime) {
  console.log(formatRegime(regime));
  if (regime.degraded) {
    console.log(
      "  File scenarios will still run, but are stamped DEGRADED-REGIME: no absolute\n" +
        "  or cross-framework file claim may be built on them (CLAUDE.md rule 7).",
    );
  }
}

// --- CPU contention preflight ------------------------------------------------
//
// Rule 7 covers the filesystem. This covers the other way a benchmark lies:
// something else on the machine eating CPU. Added after a matrix run reported
// zonix/hello at 80,787 rps against 145,779 measured an hour earlier, with
// Express down 40% and Fastify - benchmarked last, after the load cleared -
// untouched. The cause was background agent processes, not the framework.
//
// Measured from os.cpus() tick counters rather than by timing a spin loop: on a
// multi-core machine a single spinning thread just takes an idle core and
// reports everything is fine while the other cores are saturated. Tick deltas
// see the whole machine.

/** System-wide CPU utilization above which the machine counts as busy. */
export const CPU_BUSY_UTILIZATION = 0.2;

function cpuTicks() {
  let idle = 0;
  let total = 0;
  for (const cpu of osCpus()) {
    for (const [kind, value] of Object.entries(cpu.times)) {
      total += value;
      if (kind === "idle") idle += value;
    }
  }
  return { idle, total };
}

/**
 * Sample system-wide CPU utilization across every core.
 *
 * This process is essentially idle while sampling, so what it measures is other
 * people's work.
 */
export async function measureCpu({ sampleMs = 400 } = {}) {
  const before = cpuTicks();
  await new Promise((resolve) => setTimeout(resolve, sampleMs));
  const after = cpuTicks();

  const totalDelta = after.total - before.total;
  const idleDelta = after.idle - before.idle;
  const utilization = totalDelta > 0 ? 1 - idleDelta / totalDelta : 0;
  const busy = utilization > CPU_BUSY_UTILIZATION;

  return {
    utilization,
    cores: osCpus().length,
    busy,
    stamp: busy ? "BUSY-MACHINE" : "OK",
    threshold: CPU_BUSY_UTILIZATION,
  };
}

export function formatCpu(cpu) {
  return (
    `cpu: ${cpu.stamp} - ${(cpu.utilization * 100).toFixed(1)}% system-wide across ` +
    `${cpu.cores} cores (busy above ${(cpu.threshold * 100).toFixed(0)}%)`
  );
}

/**
 * Print the CPU preflight. A busy machine is not fatal - sometimes you have to
 * measure anyway - but it is stamped, and nothing measured under it should be
 * compared with anything measured elsewhere.
 */
export function reportCpu(cpu) {
  console.log(formatCpu(cpu));
  if (cpu.busy) {
    console.log(
      "  Another process is competing for CPU. Numbers from this run are not\n" +
        "  comparable with any other session, and a sequential matrix will charge\n" +
        "  the contention to whichever framework happens to run during it.",
    );
  }
}

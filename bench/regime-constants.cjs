// THE regime detector constants — the only copy (rule 7, recalibrated).
//
// CJS on purpose: `probe.cjs` (the double-clickable admin-side check) requires
// it, and `regime.mjs` imports it through Node's CJS interop. Two copies of a
// threshold is how they drift apart; this file exists so there is exactly one.
//
// Calibration (both regimes MEASURED on the reference rig, Session 10/11):
//   clean          ≈ 48,000 opens/sec @ ~12.5×  (plain NTFS CreateFile cost)
//   filter-driver  ≈  5,000 opens/sec @ ~124×   (every open intercepted)
// The lines below sit mid-gap — an order of magnitude from each signal —
// unlike the original 50,000 round-number guess, which sat ON the clean noise
// band and flickered across consecutive clean runs.
//
// Degraded = opens below DEGRADED_OPENS_PER_SEC OR ratio above DEGRADED_RATIO.
// The ratio is the tell that separates a filter driver from a merely slow
// disk: a slow disk slows opens AND fd-reads together; interposition taxes
// only the open.

"use strict";

/** Below this many open+read+close cycles/sec, the context is degraded. */
const DEGRADED_OPENS_PER_SEC = 20_000;

/** Above this fd-reads-per-open ratio, the context is degraded. */
const DEGRADED_RATIO = 40;

/** Classify one reading. */
function isDegraded(opensPerSec, ratio) {
  return opensPerSec < DEGRADED_OPENS_PER_SEC || ratio > DEGRADED_RATIO;
}

/**
 * The execution-context fingerprint recorded with every regime reading.
 *
 * Session 11's finding: "the machine" can be two machines — an interactive
 * shell and a harness context can sit in different regimes simultaneously.
 * A reading without its fingerprint is unattributable.
 */
function captureFingerprint() {
  const os = require("node:os");
  return {
    platform: process.platform,
    release: os.release(),
    cwd: process.cwd(),
    tmpdir: os.tmpdir(),
    execPath: process.execPath,
    node: process.version,
  };
}

function formatFingerprint(fp) {
  return (
    `context: ${fp.platform} ${fp.release} node ${fp.node}\n` +
    `  cwd ${fp.cwd}\n  tmp ${fp.tmpdir}\n  exe ${fp.execPath}`
  );
}

module.exports = {
  DEGRADED_OPENS_PER_SEC,
  DEGRADED_RATIO,
  isDegraded,
  captureFingerprint,
  formatFingerprint,
};

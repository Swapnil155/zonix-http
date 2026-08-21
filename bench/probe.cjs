// The two-second regime check. Run it from any shell, any context:
//
//   node bench/probe.cjs
//
// Measures open+read+close cycles/sec and reads/sec on an already-open fd, in
// BOTH the repo and %TEMP%, prints the execution-context fingerprint, and
// gives the verdict. The thresholds come from bench/regime-constants.cjs —
// the SAME module the bench harness uses, so this probe and the harness can
// never disagree about what "degraded" means.
//
// Why the fingerprint matters (Session 11): the same machine gave 48k
// opens/sec in an interactive shell and 4k in the harness context at the same
// time. A reading without its context is unattributable; compare probes ONLY
// when their fingerprints match.
const fs = require("fs");
const path = require("path");
const os = require("os");
const {
  DEGRADED_OPENS_PER_SEC,
  DEGRADED_RATIO,
  isDegraded,
  captureFingerprint,
  formatFingerprint,
} = require("./regime-constants.cjs");

function probe(dir, label) {
  const p = path.join(dir, ".probe.tmp");
  fs.writeFileSync(p, Buffer.alloc(1024, 65));
  const buf = Buffer.alloc(1024);
  let opens = 0;
  let t0 = Date.now();
  while (Date.now() - t0 < 1000) {
    const fd = fs.openSync(p, "r");
    fs.readSync(fd, buf, 0, 1024, 0);
    fs.closeSync(fd);
    opens++;
  }
  const fd = fs.openSync(p, "r");
  let reads = 0;
  t0 = Date.now();
  while (Date.now() - t0 < 1000) {
    fs.readSync(fd, buf, 0, 1024, 0);
    reads++;
  }
  fs.closeSync(fd);
  fs.unlinkSync(p);
  const ratio = reads / opens;
  const degraded = isDegraded(opens, ratio);
  console.log(
    `${label.padEnd(8)} opens/sec: ${String(opens).padStart(7)}  ` +
      `fd-reads/s: ${String(reads).padStart(7)}  ratio: ${ratio.toFixed(1)}x  ` +
      `-> ${degraded ? "DEGRADED" : "clean"}`,
  );
  return { opens, reads, ratio, degraded };
}

console.log(formatFingerprint(captureFingerprint()));
console.log(
  `thresholds: degraded below ${DEGRADED_OPENS_PER_SEC.toLocaleString("en-US")} opens/sec ` +
    `or above ${DEGRADED_RATIO}x ratio\n`,
);

const repo = probe(__dirname, "repo");
const temp = probe(os.tmpdir(), "%TEMP%");

console.log("");
if (!repo.degraded) {
  console.log(
    "VERDICT: REGIME CLEAN in this context - no open() interposition; file scenarios\n" +
      "and cross-framework claims are adjudicable here (rule 7).",
  );
} else if (repo.degraded && !temp.degraded) {
  console.log("VERDICT: INVERTED - repo degraded but %TEMP% clean; exclusion misconfigured.");
} else if (repo.opens < DEGRADED_OPENS_PER_SEC && repo.ratio > DEGRADED_RATIO) {
  console.log(
    "VERDICT: STILL DEGRADED in this context - filter-driver signature (slow opens,\n" +
      "fast fd-reads). The exclusion is not effective for THIS execution context.",
  );
} else {
  console.log(
    "VERDICT: DEGRADED, but the signature is ambiguous (slow opens without the\n" +
      "ratio spike, or vice versa) - could be a slow disk or contention, not a filter.",
  );
}
console.log("Compare probes only when their fingerprints match (Session 11).");

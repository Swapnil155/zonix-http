#!/usr/bin/env bash
# Benchmark zonix against Express and Fastify on one hello-world JSON route.
#
#   npm run bench
#
# Each server runs in its own process, is warmed up, then hit with
# autocannon -c 100 -p 10 -d 10. Results print as a markdown table.
set -euo pipefail

cd "$(dirname "$0")/.."

CONNECTIONS=${CONNECTIONS:-100}
PIPELINE=${PIPELINE:-10}
DURATION=${DURATION:-10}
WARMUP=${WARMUP:-3}

echo "Building zonix..."
npm run --silent build

# A repo-local directory rather than mktemp: under Git Bash on Windows a
# "/tmp/..." path is not what node resolves it to.
results_dir="bench/.results"
rm -rf "$results_dir"
mkdir -p "$results_dir"
trap 'rm -rf "$results_dir"' EXIT

run_one() {
  local name=$1 script=$2 port=$3

  node "$script" &
  local pid=$!

  # Wait for the port to answer rather than sleeping a fixed amount.
  local ready=0
  for _ in $(seq 1 50); do
    if curl -sf "http://127.0.0.1:${port}/" > /dev/null 2>&1; then ready=1; break; fi
    sleep 0.2
  done
  if [ "$ready" -ne 1 ]; then
    echo "  ${name}: server never became ready" >&2
    kill "$pid" 2> /dev/null || true
    return 1
  fi

  echo "  ${name}: warming up..."
  npx --no-install autocannon -c "$CONNECTIONS" -p "$PIPELINE" -d "$WARMUP" \
    "http://127.0.0.1:${port}/" > /dev/null 2>&1

  echo "  ${name}: measuring..."
  npx --no-install autocannon -c "$CONNECTIONS" -p "$PIPELINE" -d "$DURATION" -j \
    "http://127.0.0.1:${port}/" > "${results_dir}/${name}.json" 2> /dev/null

  kill "$pid" 2> /dev/null || true
  wait "$pid" 2> /dev/null || true
}

echo "Running ${DURATION}s at -c ${CONNECTIONS} -p ${PIPELINE} (plus ${WARMUP}s warmup)..."
run_one zonix bench/zonix.js 3001
run_one express bench/express.js 3002
run_one fastify bench/fastify.js 3003

node --input-type=module -e "
import { readFileSync } from 'node:fs';
const dir = 'bench/.results';
const rows = ['zonix', 'express', 'fastify'].map((name) => {
  const r = JSON.parse(readFileSync(\`\${dir}/\${name}.json\`, 'utf8'));
  return {
    name,
    rps: r.requests.average,
    latency: r.latency.average,
    throughput: r.throughput.average / 1024 / 1024,
  };
});
const baseline = rows.find((r) => r.name === 'express').rps;
const fmt = (n, d = 0) => n.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });

console.log('');
console.log('| Framework | Requests/sec | Latency (ms) | Throughput (MB/s) | vs Express |');
console.log('| --------- | -----------: | -----------: | ----------------: | ---------: |');
for (const r of rows) {
  console.log(
    \`| \${r.name} | \${fmt(r.rps)} | \${fmt(r.latency, 2)} | \${fmt(r.throughput, 1)} | \${fmt((r.rps / baseline) * 100)}% |\`,
  );
}
console.log('');
console.log(\`Node \${process.version}, -c ${CONNECTIONS} -p ${PIPELINE} -d ${DURATION}\`);
"

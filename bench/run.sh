#!/usr/bin/env bash
# Thin wrapper: the runner itself is bench/run.mjs so the median math and the
# server lifecycle are the same on every platform.
set -euo pipefail
cd "$(dirname "$0")/.."
npm run --silent build
node bench/run.mjs "$@"

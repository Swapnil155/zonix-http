# D8 — the pinned bench container: the OFFICIAL environment for file scenarios
# and every cross-framework claim.
#
# Why this exists: the host is a Windows machine whose filesystem filter driver
# intercepts every open() (~4k opens/sec, ~125x slower than reading an open fd),
# and a Defender exclusion that looked like it fixed it reverted after a reboot
# under managed policy. Six sessions of file-scenario work were frozen on that.
# The container changes courtrooms instead of winning the argument: ext4, no
# filter driver, clean by construction - and reproducible by anyone with
# `docker run`, which no competitor's benchmark page offers.
#
# Rules baked in (D8, binding):
#   - pinned base image, never `node:22` floating;
#   - the repo is COPIED in - NEVER bind-mounted from C:\ (Docker Desktop's
#     file-sharing bridge would recreate degraded-regime numbers for a
#     different reason and the whole lesson would repeat);
#   - the regime probe + context fingerprint run on entry, every time.
#
# Build/run via bench/container.mjs, which pins --cpus and records the entry
# probe alongside the bench output.

FROM node:22.20.0-bookworm-slim

WORKDIR /zonix

# Dependencies first, for layer caching. Every devDependency is needed: the
# bench competitors (express, fastify, autocannon) and the build chain (tsup).
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# Then the repo - filtered by .dockerignore (no node_modules, no dist, no
# scratch dirs, no .git) so the image is deterministic.
COPY . .

RUN npm run build

# On entry: fingerprint + regime probe, then whatever command was given.
# The probe writes into the container's own ext4 layer, which is the point.
ENTRYPOINT ["/bin/sh", "-c", "node bench/probe.cjs && echo && exec \"$@\"", "--"]
CMD ["node", "bench/run.mjs"]

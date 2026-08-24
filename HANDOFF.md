# HANDOFF

**Phase 9 CLOSED (S30): zonix-http live on npm** (provenance; CI green on
GitHub runners Node 20/22/24; install-from-registry smoke passed). README +
SECURITY.md shipped, scorecard as neutral measurements (filings prereq
dropped by Swapnil); numbers verbatim from results.md. Details: git log.

**S31 (2026-08-24, post-launch):** 0.1.1 (README: Guide with 8 snippet-verified
feature areas + Performance recipes; npm page refreshed) and 0.1.2 (OIDC
verification) published. **Release auth is now npm Trusted Publishing (OIDC)**
— release.yml token-free (gotchas fixed: setup-node registry-url writes an
.npmrc reading $NODE_AUTH_TOKEN and must be dropped; the publisher entry's
username is case-sensitive: `Swapnil155`, not `swapnil155` — E404-on-PUT was
the symptom). npm account has 2FA (security key). Stray `50000` file removed.
Repo renamed lowercase zonix-http.

## Open items (Swapnil)

1. **Pick the dogfood service** — the v1.0.0 clock started today.
2. Revoke the now-unused broad npm token (npm Settings → Access Tokens),
   delete the NPM_TOKEN GitHub secret, and on the package's npm Settings
   select "Require 2FA and disallow bypass 2fa tokens (recommended)".
3. Upstream filings (Express docs PR, Fastify discussion) remain DRAFTED,
   NOT filed — only needed if the README ever adds mechanism claims (W2).

**Next session: open with the dogfood service's first friction list.**

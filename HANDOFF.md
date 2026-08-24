# HANDOFF

**Phase 9 CLOSED (S30): zonix-http live on npm** (provenance; CI green on
GitHub runners Node 20/22/24; install-from-registry smoke passed). README +
SECURITY.md shipped, scorecard as neutral measurements (filings prereq
dropped by Swapnil); numbers verbatim from results.md. Details: git log.

**S31:** 0.1.1 (README guide) + 0.1.2 (OIDC verified) published. Release auth
= npm Trusted Publishing, release.yml token-free (drop setup-node
registry-url; publisher username is case-sensitive `Swapnil155`). 2FA on.

**S32: 0.2.0 features BUILT (`5d75a26`), suite 940/940.** req.signedCookies
(cookie-parser@1.4.7 oracle 25/25 incl 2k fuzz; deviations: **proto**-named
cookie kept as inert null-proto data vs oracle drops; empty name dropped vs
oracle keeps; rotation arrays; j: revival both maps) + serveStatic
maxAge/immutable (send wire format, express.static diff, rides 304/206/cache
paths, off unless set) + CHANGELOG.md + gh-release step in release.yml
(contents: write). README guide updated. **v0.2.0 SHIPPED (S32):** gate
first-run VOIDED (spread 20.2%), valid rerun PASS -0.55% (spreads 1.4/2.4)
vs a v0.1.2-worktree baseline — record in results.md "0.2.0 gate"; OIDC
publish green; first auto GitHub Release (v0.2.0) created.

## Open items (Swapnil)

1. **Pick the dogfood service** — the v1.0.0 clock started today.
2. Revoke the now-unused broad npm token (npm Settings → Access Tokens),
   delete the NPM_TOKEN GitHub secret, and on the package's npm Settings
   select "Require 2FA and disallow bypass 2fa tokens (recommended)".
3. Upstream filings (Express docs PR, Fastify discussion) remain DRAFTED,
   NOT filed — only needed if the README ever adds mechanism claims (W2).

**Next session: open with the dogfood service's first friction list.**

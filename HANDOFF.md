# HANDOFF

**Phase 9 CLOSED (S30, 2026-08-24): `zonix-http@0.1.0` IS LIVE ON NPM,**
published by release.yml with provenance (attestations URL on the registry).
Repo public at github.com/Swapnil155/Zonix-http (capital Z — rename to
lowercase optional; GitHub redirects, provenance passed as-is). CI green on
GitHub's own runners (Node 20/22/24 + coverage + pack smoke) — first-party
proof of the three-Node claim. First Release run failed at Publish (token or
case, log needed auth; Swapnil changed something browser-side), tag re-push
succeeded. Verified post-publish: registry shows 0.1.0, dist 6 files,
attestations present; fresh install from the PUBLIC registry in an empty
project served 200 on a route (install smoke, this machine).

S29–S30 also: SECURITY.md + README shipped (filings prereq dropped by
Swapnil — scorecard shown as neutral measurements, no W2 mechanism claim,
losses printed plainly; all numbers verbatim from results.md; 13/13
SECURITY.md test-cites resolve; quick-start run live). Spec committed
(CLAUDE.md + HISTORY.md now tracked). repository/bugs/homepage fields added.

## Open items (Swapnil)

1. **Pick the dogfood service** — the v1.0.0 clock started today.
2. Optional: rename repo to lowercase `zonix-http`; rotate the npm token
   (it was broad: all-packages read-write, 2FA-bypass) for a
   package-scoped one now that the package exists; enable private
   vulnerability reporting if not done.
3. Upstream filings (Express docs PR, Fastify discussion) remain DRAFTED,
   NOT filed — only needed if the README ever adds mechanism claims (W2).

**Next session (v0.2.0 track or maintenance): open with the dogfood
service's first friction list.**

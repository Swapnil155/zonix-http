# HANDOFF

**Security audit COMPLETE (S33, 2026-08-25). Verdict: APPROVED WITH CONDITIONS.**
Executed SECURITY_AUDIT.md phases 0-6, ZH-001..029, one commit per finding.
Full report: `docs/security/audit-report.md`.

## Fixed (confirmed vulns + hardening)

- **ZH-001 Critical (CWE-59):** serveStatic symlink escape — realpath-validate
  every served file (direct/cache/index) vs the real root. `7d07666`
- **ZH-020 High (CWE-158):** `%00` in route param → 400 (was literal NUL to
  handlers). `bc560a2`
- **ZH-004 High (CWE-400):** pinned configurable timeouts headers/request/
  keepAlive (60s/300s/5s, 0 disables). `00a9dde`
- **ZH-007 High hardening:** assertHeaderValue now rejects all control chars +
  validates header names (RFC 7230 token). `a110705`
- **ZH-022 hardening:** new opt-in `securityHeaders()` middleware. `20bac9c`

## Verified safe (regression-locked, no code change)

ZH-002 smuggling, ZH-003/006 proto-pollution, ZH-005 body, ZH-008 host, ZH-009
routing, ZH-010 ReDoS, ZH-013 proxy, ZH-014 redirect (app duty), ZH-015
compression, ZH-016 cookies, ZH-017 errors, ZH-018 methods, ZH-019 limits.
N/A (absent, documented): ZH-011 multipart, ZH-012 ws, ZH-023 TLS.

## State

Suite **1017 pass / 1 skip / 0 fail** (was 940). tsc clean; npm audit 0; 0 deps.
`test/security/` = 16 files, 78 tests. SECURITY.md/README/CHANGELOG updated.
All committed on master. **Next: cut 0.3.0** with the audit fixes when ready.

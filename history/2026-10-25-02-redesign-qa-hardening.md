# UI redesign, QA and security hardening

- **Date:** 2026-10-25
- **Commits:** 59e309f, 3362240, f323683
- **Tests:** 205 passing. Demo script 39/39 on a fresh install.

## Changes
- New component kits (dashboard, landing, ops, people), redesigned app shell and pages, 3D entry screens (react-three-fiber).
- Leave decisions apply only to still-pending requests (fixes the approve/cancel race).
- Exited or inactive employees lose their login.
- Security headers (`X-Frame-Options`, `frame-ancestors`, `nosniff`, `Referrer-Policy`), no `X-Powered-By`, body size limit (3 MB), Prisma error codes mapped to generic 404/409.
- AI fixes: empty-chat 500, self-reference, clarifying questions in smart leave, policy wording, token-limit handling, summary grounded per filter.
- New test suites: business accuracy, leave edge cases, performance, AI audit, and the endpoint × role security matrix.
- Leave entry wired to the configured leave types. Balance loading/error/empty states. Notification empty-link handling and error surfacing.

## Decisions
- The security matrix globs every `route.ts`, so an uncovered route fails CI instead of slipping through.

## Open / next
- `tests/security-integrity.test.ts.wip` is parked and not run.
- README still says 121 tests.

# CLAUDE.md and history log

- **Date:** 2026-10-25
- **Commits:** uncommitted
- **Tests:** not run (docs only)

## Changes
- Added `CLAUDE.md`: commands, test caveats, architecture (route → service → Prisma, session/scope, audit-in-transaction, dates/TZ, AI guard/tools/session). It imports `AGENTS.md`.
- Added `history/` with a README (convention, template, index) and entries 01–03 backfilled from git history.

## Decisions
- One file per session instead of a single CHANGELOG. Short entries focused on decisions and open items, since git already has the diffs.

## Open / next
- Commit `CLAUDE.md` and `history/`.

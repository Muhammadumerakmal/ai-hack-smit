# Project history

A running log of work sessions on HCM Lite: what changed, why, and what was left open. Git history records *what* changed in the code. This folder records the context around it: decisions, known gaps and next steps.

## How to add an entry

1. Create `history/YYYY-MM-DD-NN-short-slug.md`. `NN` is the session number for that day (01, 02, …), which keeps files sorted.
2. Copy the template below and fill it in. Keep it short and factual.
3. Add a row to the index table (newest at the bottom).
4. Commit it with the code it describes.

```markdown
# <Title>

- **Date:** YYYY-MM-DD
- **Commits:** <short hashes, or "uncommitted">
- **Tests:** <e.g. "npm test: 205 passed" / "not run">

## Changes
- …

## Decisions
- <what was chosen and why; alternatives rejected>

## Open / next
- <unfinished work, known bugs, follow-ups>
```

## Index

| Entry | Date | Summary |
|---|---|---|
| [01 Initial build](2026-10-25-01-initial-build.md) | 2026-10-25 | M1–M9 full-stack app, demo seed, first fixes |
| [02 Redesign & QA hardening](2026-10-25-02-redesign-qa-hardening.md) | 2026-10-25 | UI redesign, security hardening, business/security test suites |
| [03 Agents SDK migration](2026-10-25-03-agents-sdk-migration.md) | 2026-10-25 | Chat moved to `@openai/agents`, server-persisted conversations |
| [04 CLAUDE.md & history](2026-10-25-04-claude-md-and-history.md) | 2026-10-25 | Added CLAUDE.md and this history folder |

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
| [05 Bonus features](2026-10-25-05-bonus-features.md) | 2026-10-25 | Camera check-in, attrition risk, anomaly flags, late penalty, PWA |
| [06 PDF gap audit](2026-10-25-06-pdf-gap-audit.md) | 2026-10-25 | Face matching to an enrolled face, payroll cost by month |
| [07 Mobile layout](2026-10-25-07-mobile-layout.md) | 2026-10-25 | Phone card layouts for payroll/payslips, month labels, compact chat button |
| [08 Demo-run fixes & Leave UI](2026-10-25-08-demo-run-fixes-leave-ui.md) | 2026-10-25 | Off-day check-ins in today KPIs, "who is on leave" in a period, Leave page redesign, week bars |
| [09 Bug fixes & UI polish](2026-10-26-01-bugfix-ui-polish.md) | 2026-10-26 | Payroll stale-run fix, faster CSV import, sentence-case labels, chat panel and AI summary redesign |
| [10 Multi-company](2026-10-27-01-multi-company.md) | 2026-10-27 | "Create your company" for every visitor, fail-closed company scoping, rehearsed Neon migration |
| [11 Accessibility pass](2026-10-27-02-ui-ux-pro-max-a11y.md) | 2026-10-27 | ui-ux-pro-max skill installed; text contrast fixed in light and dark mode |
| [12 Forms, keyboard, chat a11y](2026-10-27-03-forms-nav-chat-a11y.md) | 2026-10-27 | Errors under each field, required markers, skip link, keyboard-safe phone menu, one chat live region |

# Initial build

- **Date:** 2026-10-25
- **Commits:** 447dff1, 9e68cc5, 6823602
- **Tests:** 121 passing (unit, service, route-level RBAC)

## Changes
- Next.js 16 full-stack app with PostgreSQL/Prisma and an OpenAI tool-calling assistant, built to the HCM Lite hackathon brief.
- M1 auth: first-run setup, JWT cookie login, bcrypt, forced password change, role + data-scope guard on every API, Admin user management.
- M2 org setup: settings, departments, designations, leave types, holidays.
- M3 employees: register (creates login), Employee 360, search/paging, CSV import with dry-run report, CSV export.
- M4 attendance: check-in/out, late/half-day/absent rules, calendar, daily board, corrections with HR approval.
- M5 leave: apply/cancel, balance, overlap and balance checks, approvals.
- M6 payroll: draft, finalize and lock, deductions, proration, tax slab, payslip PDF.
- M7 dashboards: Admin/HR/Employee KPIs, trends and filters.
- M8 AI assistant: role-scoped tools, dashboard summary, smart leave, policy Q&A, rate limit, timeout, `ai_logs`.
- M9 announcements, notifications, append-only audit log.
- Demo seed hashes a shared password (`Demo1234`) so seeded logins work through the real login page.
- Fix: the chat panel's `useEffect` returned the Promise from `scrollIntoView`, which React rejects. It now uses a block body.

## Decisions
- One Next.js app for both API and UI. Routes are thin and services own every rule and DB access.
- The JWT holds only the user id. Role and scope are re-read from the DB on each request so deactivation takes effect immediately.
- The AI never writes. Smart leave only pre-fills a form the user confirms.

## Open / next
- Not done per README: mobile app / camera check-in, attrition risk score, absence anomaly flags, late-penalty rule.

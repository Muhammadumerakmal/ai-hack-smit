# Multi-company: "Create your company" for every visitor

- **Date:** 2026-10-27
- **Commits:** see git log
- **Tests:** npm test: 271 (262 existing, 9 new). Lint and typecheck clean. End-to-end judge flow run in headless Chrome on a migrated copy.

## Why
The owner wants the live database to keep its company (Omar as Admin, Ali as HR, and the employees), and wants new visitors such as judges to get their own logins without depending on those accounts. A sign-up with a role picker inside the existing company was rejected, because anyone could pick Admin and read every salary. A second database for judging was also rejected, since the owner wants one database. The answer is several companies in one database: every visitor can create a separate company and becomes its Admin. Inside a company the brief's flow is unchanged.

## Changes
- **Schema:** `CompanySettings` (table `settings`) is one row per company (id autoincrement). Every other table has a required `companyId` with a foreign key and an index. Department names, designation titles, employee codes, leave type codes, holiday dates and payroll months are unique per company. Login email stays globally unique.
- **Fail-closed scoping:** `src/lib/tenant.ts` (AsyncLocalStorage: `runInCompany`, `runAsSystem`, `currentCompanyId`) and the query extension in `src/lib/db.ts` (`scopeArgs`) add the company to every where and every created row. With no context, a query throws. `withSession` runs handlers in the user's company. `publicRoute` and the session lookup run unscoped.
- `Session.companyId`. Creates set `companyId: currentCompanyId()`. Lookups by month or code use the compound keys.
- **Create your company:** `POST /api/setup` is open. It creates a company (with Section 3 leave types) and its Admin, refuses an email that is already in use (409), and allows at most 5 companies per network per hour (429). `ADMIN_EMAIL`/`ADMIN_PASSWORD` only apply to the very first company of a fresh install. The login page links to "Create your company". The setup page no longer redirects away once a company exists.
- **Tests:** `tests/setup.ts` runs every test in company 1. Fixtures and sessions carry `companyId`. The new `tests/tenancy.db.test.ts` covers `scopeArgs`, isolation of lists, 404 for another company's ids (employee, payslip PDF, password reset, leave decision), per-company unique names, and AI tools scoped to the asker's company. The auth tests cover a second company, a reused email and the throttle.
- **Bug found by the tests:** Prisma queries are lazy, so `runAsSystem(() => db.user.findUnique(...))` returned an unexecuted query that later ran outside the context. Sign-in would have failed on every request in production. Both helpers now await inside the context.
- Two summary tests depended on the date (they hard-coded 98.2% and used 37 as a "fake" number, both real on 27 Oct). They now quote today's KPI values and use 9137.
- **Migration:** reviewed SQL lives in `prisma/manual-migrations/2026-10-27-multi-company/` (add the columns with a temporary default of 1 → deploy → drop the defaults). It was rehearsed on a local database with the old schema and data: identical row counts, 0 rows outside company 1, next company id 2, empty diff afterwards.

## Decisions
- The scoping is automatic and fails closed, not a hand-written filter in each of about 150 queries, so a missed spot fails in tests instead of leaking data.
- Client-supplied foreign ids are always looked up (scoped) before they are written. That lookup is the cross-company guarantee for foreign keys.
- `prisma db push --force-reset` is refused for AI agents without consent, so local test databases were created fresh (`hcm_mt`) instead of reset.

## Open / next
- **Live Neon migrated on 2026-10-27** with the owner's go-ahead: a read-only check confirmed the live schema matched the pre-migration schema, then 1-add-company-columns.sql → push 50f3338 (Vercel live after about 60 s) → 2-drop-temporary-defaults.sql. Row counts were identical before and after (users 9, employees 5, audit_logs 47, …), 0 rows ended up outside company 1 ("umer akmal"), the next company id is 2, and `migrate diff` against the new schema was empty. The owner skipped the pg_dump backup.
- The Neon password was pasted into the chat during the migration, so it should be rotated (Neon → Roles → reset password), then `DATABASE_URL` updated in Vercel and `.env`.
- The company throttle is in memory per server instance, like the login throttle.
- The local `hcm` dev DB is migrated and now holds a test "Judge Co" (company 2) next to Demo Co.

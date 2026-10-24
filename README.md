# HCM Lite

AI-assisted Human Capital Management for Admin, HR and Employees (Saylani Hackathon, 24 Oct 2026).

**Stack:** Next.js 16 (App Router, full stack: REST API + UI) · PostgreSQL + Prisma · OpenAI (Agents SDK `@openai/agents` with tool calling) · JWT (httpOnly cookie) + bcrypt · Tailwind · Vitest

## Run it locally (about 5 minutes)

```bash
npm install
cp .env.example .env            # set AI_API_KEY and JWT_SECRET (any long random string)
docker compose up -d            # local Postgres on :5432
npx prisma db push              # create the tables
npm run dev                     # http://localhost:3000
```

**First Admin:** open http://localhost:3000. A fresh install shows the first-run setup, which asks for the company name and the Admin account. To skip typing them, set `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `.env`. Admin then creates HR logins. When HR registers an employee, that creates the employee's login with a temporary password, which must be changed on first sign-in.

**AI key:** set `AI_API_KEY` (OpenAI) in `.env`, or in the host's environment settings. Only the server reads it. `AI_MODEL` defaults to `gpt-4.1-mini`. Any OpenAI-compatible provider works via `AI_BASE_URL`.

**Hosting (Vercel + Neon):** set `DATABASE_URL` (Neon pooled URL, add `&connect_timeout=30`), `JWT_SECRET`, `AI_API_KEY`, `APP_TZ=Asia/Karachi`. The build runs `prisma generate`. Create the tables once with `npx prisma db push` against the Neon **direct** URL (without `-pooler`).

**Tests:** `npm test` runs 121 tests (unit + database + route-level RBAC). They need the docker Postgres and reseed it. `npm run dev:seed -- --yes` fills a **local** database with a demo company for manual testing; it refuses to run in production or against a non-local database.

## What is done

| # | Module | Status |
|---|---|---|
| M1 | Auth & access: first-run setup, JWT login/logout, bcrypt, forced password change, role + data-scope guard on every API, Admin user management (create HR, deactivate, reset password, HR⇄Employee) | ✅ |
| M2 | Organization setup: office hours, grace, half-day hours, weekend, office location + radius, departments, designations, leave types + quotas, holidays | ✅ |
| M3 | Employees: register (creates login), edit, server-side search/filter/paging, Employee 360, salary structure, CSV import with dry-run report (row + field + reason), CSV export | ✅ |
| M4 | Attendance: web check-in/out (server time, 409 on second check-in), late / half day / absent / missing checkout, calendar, daily board, correction request + HR approval | ✅ |
| M5 | Leave: apply, cancel, balance, working days only, overlap / balance checks (422), HR approval inbox with comments | ✅ |
| M6 | Payroll: monthly draft (HR), finalize + lock (Admin), gross 1.5 × basic, per-day deductions, proration, tax slab, payslip PDF | ✅ |
| M7 | Dashboards: Admin / HR / Employee, KPIs, trends, insight lists, date + department filters, all computed on the server | ✅ |
| M8 | AI assistant: chat with 7 role-scoped tools, dashboard summary, smart leave, policy Q&A, guardrails (below) | ✅ |
| M9 | Announcements, in-app notifications, append-only audit log with before/after JSON | ✅ |
| Bonus | AI understands Roman Urdu · dark mode (follows the system setting) | ✅ |

**Not done:** mobile app and camera/face check-in (optional bonus), attrition risk score, absence anomaly flags, the late-penalty rule. The frontend is intentionally basic (the backend was the priority).

## Roles

- **Admin:** company setup, logins, view everything, finalize payroll, audit log, AI on all data.
- **HR:** register and edit employees, salary, approvals (leave, attendance corrections), payroll draft, HR dashboard, AI on HR data.
- **Employee:** check in/out, own attendance, leave (incl. smart leave), payslips, own profile (phone/address), AI on own data and policy.

Access is checked on the server for every request (`withSession` → role guard → service-level scope). Employees can only ever read rows with their own `employee_id`.

## M8 AI Assistant

The AI explains and assists; the database is the only source of truth.

```
Browser ──POST /api/ai/chat──▶ guard (auth · active user · 20/h · 15 s · ai_logs)
                                  │
                                  ▼
                        OpenAI (Agents SDK; tools for this role only)
                                  │ tool call
                                  ▼
                 runTool → role check → zod args → services ──▶ Postgres
                 (the same services the REST API and dashboards call)
```

| Feature | Endpoint | Who |
|---|---|---|
| Ask the assistant | `POST /api/ai/chat` (also `/ai/chat`) | All |
| Dashboard summary | `POST /api/ai/summary` | Admin, HR |
| Smart leave | `POST /api/ai/smart-leave` → pre-filled form, user confirms | Employee, HR |
| Policy Q&A | inside chat (Section 3 rules + live settings in the system prompt) | All |

**Tools:** `get_headcount`, `get_attendance_summary`, `get_late_comers`, `get_leave_summary`, `get_my_leave_balance`, `get_payroll_summary`, `search_employees`.

**Guardrails:**
- The key is read only on the server.
- The model is offered only its role's tools, and `runTool` checks the role again, so an employee asking for a colleague's salary has no tool that could answer.
- The model never touches the database or saves anything. Smart leave only pre-fills the form.
- JSON output is validated with one retry, then the normal form appears. Summary bullets may only quote numbers that appear in the KPI JSON.
- 15 s timeout with a friendly fallback, 20 requests per user per hour, and every call is logged in `ai_logs`.
- Answers carry an **AI-generated** label.

## Project layout

```
prisma/schema.prisma          data model (users, employees, attendance, leave, payroll, settings, audit, AI logs …)
src/server/services/*.ts      business rules (one service per module); the only code that touches the DB
src/server/ai/*.ts            M8: chat agent (OpenAI Agents SDK), tools, summary, smart leave, guard
src/app/api/**/route.ts       REST API (thin: session + validation → service)
src/app/(app)/**/page.tsx     screens (role-based menu in src/components/shell/AppShell.tsx)
tests/*.test.ts               unit, service and route-level tests
```

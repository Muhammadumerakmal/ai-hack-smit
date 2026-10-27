# HCM Lite

AI-assisted Human Capital Management for Admin, HR and Employees.

**Live app:** https://ai-hack-smit.vercel.app · **Repository:** https://github.com/Muhammadumerakmal/ai-hack-smit

**Stack:** Next.js 16 (App Router, full stack: REST API + UI) · PostgreSQL + Prisma · OpenAI (Agents SDK `@openai/agents` with tool calling) · JWT (httpOnly cookie) + bcrypt · Tailwind · Vitest

## Run it locally (about 5 minutes)

```bash
npm install
cp .env.example .env            # set AI_API_KEY and JWT_SECRET (any long random string)
docker compose up -d            # local Postgres on :5432 (local only; the hosted app uses Neon, not Docker)
npx prisma db push              # create the tables
npm run dev                     # http://localhost:3000
```

**First Admin:** open http://localhost:3000. A fresh install shows **Create your company**, which asks for the company name and the Admin account. To skip typing them on a fresh install, set `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `.env`. Admin then creates HR logins. When HR registers an employee, that creates the employee's login with a temporary password, which must be changed on first sign-in.

**Several companies, one database:** anyone can click **Create your company** on the sign-in page and becomes the Admin of a new, separate company. Every table carries a `companyId`, and every query runs inside the signed-in user's company, so companies never see each other's people, attendance, leave, payroll, audit log or AI answers. Judges can each create their own company on the live link while the existing company keeps its data. Logins are never self-registered inside an existing company: its Admin creates HR logins and HR registers employees.

**AI key:** set `AI_API_KEY` (OpenAI) in `.env`, or in the host's environment settings. Only the server reads it. `AI_MODEL` defaults to `gpt-4.1-mini`. Any OpenAI-compatible provider works via `AI_BASE_URL`.

**Hosting (Vercel + Neon):** set `DATABASE_URL` (Neon pooled URL, add `&connect_timeout=30`), `JWT_SECRET`, `AI_API_KEY`, `APP_TZ=Asia/Karachi`. The build runs `prisma generate`. Create the tables once with `npx prisma db push` against the Neon **direct** URL (without `-pooler`). Run it again after pulling schema changes (the bonus features added columns).

**Upgrading an existing single-company database:** run the reviewed SQL in `prisma/manual-migrations/2026-10-27-multi-company/` (steps in its README). Existing data becomes company 1; nothing is deleted.

**Tests:** `npm test` runs 271 tests (unit + database + route-level RBAC). They need the docker Postgres and reseed it. `npm run dev:seed -- --yes` fills a **local** database with a demo company for manual testing; it refuses to run in production or against a non-local database.

## What is done

| # | Module | Status |
|---|---|---|
| M1 | Auth & access: first-run setup, JWT login/logout, bcrypt, forced password change, role + data-scope guard on every API, Admin user management (create HR, deactivate, reset password, HR⇄Employee) | ✅ |
| M2 | Organization setup: office hours, grace, half-day hours, weekend, office location + radius, departments, designations, leave types + quotas, holidays | ✅ |
| M3 | Employees: register (creates login), edit, server-side search/filter/paging, Employee 360, salary structure, CSV import with dry-run report (row + field + reason), CSV export | ✅ |
| M4 | Attendance: web check-in/out (server time, 409 on second check-in), late / half day / absent / missing checkout, calendar, daily board, correction request + HR approval | ✅ |
| M5 | Leave: apply, cancel, balance, working days only, overlap / balance checks (422), HR approval inbox with comments | ✅ |
| M6 | Payroll: monthly draft (HR), finalize + lock (Admin), gross 1.5 × basic, per-day deductions, proration, tax slab, payslip PDF | ✅ |
| M7 | Dashboards: Admin / HR / Employee, KPIs, trends, insight lists, payroll cost by month, date + department filters, all computed on the server | ✅ |
| M8 | AI assistant: chat with 7 role-scoped tools, dashboard summary, smart leave, policy Q&A, guardrails (below) | ✅ |
| M9 | Announcements, in-app notifications, append-only audit log with before/after JSON | ✅ |
| Bonus | Camera attendance on the web: face detection + location, a blink liveness check, and matching to the employee's enrolled face | ✅ |
| Bonus | Attrition risk score and absence anomaly flags (dashboard, AI summary, AI tool) | ✅ |
| Bonus | Late penalty rule (3 lates = 0.5 day), Admin switch, shown on payroll and the payslip PDF | ✅ |
| Bonus | AI understands Roman Urdu · dark mode (follows the system setting) · PWA (installable, offline page) | ✅ |

**Not done:** a native mobile app (optional in Section 5). Camera check-in runs in the mobile or laptop browser instead, and the app can be installed on a phone as a PWA.

## Bonus features

**Camera check-in (Section 5).** The *Use camera* button on the dashboard or attendance page opens the front camera. MediaPipe's face landmarker (`@mediapipe/tasks-vision`, runs on the device) needs **exactly one face** and **a blink**. The browser sends `{ method: "camera", lat, lng, accuracy, faces, liveness }` to `POST /api/attendance/check-in`, and the **server** decides. It rejects with 422 if there is no face or more than one, no blink, GPS accuracy worse than 100 m, or a Haversine distance to the office beyond the radius. The time is stamped by the server as usual. Only the distance and GPS accuracy are stored (`source = camera`): no photo and no coordinates. A failed check points to an HR attendance correction.

**Face matching (extra bonus).** Each employee enrols their face once from **My profile**. face-api.js (`@vladmandic/face-api`, on the device) turns it into a 128-number face descriptor, which is stored in its own `face_profiles` table and never as a photo. From then on, every camera check-in sends a fresh descriptor, and the **server** refuses it (422) unless the Euclidean distance to the enrolled one is 0.55 or less. Only the result (`faceVerified`) is kept on the attendance row. The descriptor never appears in any API response or in the audit log. Changing an enrolled face needs HR to **Reset face** on the employee's profile (audited, and the employee is notified). Admin sets the office pin (with a *Use my current location* button) and the radius in Company setup, and can switch on **Require camera check-in**, which turns off the plain web button. The camera and GPS need HTTPS (or localhost). The face model loads from the jsDelivr / Google CDNs on first use.

**Attrition risk score.** A rule-based score out of 100 for each active employee over the last 90 days: absenteeism 30 · lateness 20 · absence rising in the last 30 days 20 · unpaid leave 15 · tenure under a year 15. High ≥ 60, medium ≥ 35. Every score lists its reasons. It needs 5 working days of history.

**Absence anomaly flags** (inside the dashboard period): 3+ working days absent in a row (5+ is high), 2+ absences next to a weekend or holiday, 3+ missing check-outs, and absence at least twice the group's rate.

Both run on the same day rows as the dashboards, so every flag can be checked on the attendance calendar. They appear on the HR/Admin dashboards and in the KPI JSON behind **Summarize**, and the assistant can answer "who is at risk of leaving?" through the HR/Admin tool `get_people_insights`.

**Late penalty.** Off by default, because Section 3 doesn't have it. When Admin switches it on, every 3 late days in a month deduct half a day in that month's payroll (7 lates = 1 day). The payroll table and the payslip PDF show it, and policy Q&A explains it.

**PWA.** `app/manifest.ts`, icons, and a service worker (`public/sw.js`, production builds only) that caches build assets and shows an offline page. It **never caches `/api`**, so personal data is always live.

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

**Tools:** `get_headcount`, `get_attendance_summary`, `get_late_comers`, `get_leave_summary`, `get_my_leave_balance`, `get_payroll_summary`, `search_employees`, plus the bonus `get_people_insights` (Admin/HR: attrition risk and absence anomalies).

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

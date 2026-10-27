# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

HCM Lite is an AI-assisted HR system (Admin / HR / Employee). It's a single Next.js 16 App Router app that serves both the REST API and the UI. It uses PostgreSQL via Prisma 6, the OpenAI Agents SDK (`@openai/agents`) for the assistant, JWT in an httpOnly cookie (`token`) with bcrypt, Tailwind 4, and Vitest 4. `README.md` has the module checklist (M1–M9) and the role descriptions.

## Commands

```bash
docker compose up -d          # local Postgres 16 on :5432 (user/pass/db: hcm/hcm/hcm)
npx prisma db push            # sync prisma/schema.prisma to the DB (no migrations folder; schema is pushed)
npm run db:push:local         # same, but forces DATABASE_URL from .env.local
npm run dev                   # http://localhost:3000 (fresh DB → first-run /setup screen)
npm run dev:seed -- --yes     # demo company in a LOCAL db; every demo login uses password Demo1234
npm run build                 # prisma generate && next build
npm run lint                  # eslint (next core-web-vitals + typescript)
npm run typecheck             # tsc --noEmit
npm test                      # vitest run (all of tests/**/*.test.ts)

npx vitest run tests/biz-leave.db.test.ts             # one file
npx vitest run tests/unit.test.ts -t "working days"   # one test by name
TEST_DATABASE_URL=postgresql://hcm:hcm@localhost:5432/hcm_test npx vitest run   # run against a separate DB
```

Env: `.env.local` overrides `.env`. Locally `.env.local` points at docker Postgres and `.env` holds the hosted Neon URL. Required: `DATABASE_URL`, `JWT_SECRET`, `AI_API_KEY`. Optional: `AI_MODEL` (default `gpt-4.1-mini`), `AI_BASE_URL` (any OpenAI-compatible provider), `AI_TIMEOUT_MS`, `AI_RATE_LIMIT_PER_HOUR`, `APP_TZ` (default `Asia/Karachi`), `ADMIN_EMAIL`/`ADMIN_PASSWORD`.

### Test caveats
- **DB tests TRUNCATE every table and reseed** (`tests/helpers.ts → seed()`). By default they use the `DATABASE_URL` from `.env`/`.env.local`, which is your dev database. Pass `TEST_DATABASE_URL` if you want to keep dev data.
- DB suites run only when `DATABASE_URL` points at localhost/127.0.0.1 (`describe.skipIf(!hasDb)`). Files run serially (`fileParallelism: false`) because they share one DB.
- Tests call route handlers directly with `call(handler, { userId, body, params, url })` from `tests/helpers.ts`, which signs a real JWT cookie. There is no HTTP server.
- The AI is never called live in tests. Inject fakes with `setChatModel(new ScriptedModel([...]))` (chat, Agents SDK) and `setLlm(...)` (summary / smart leave). Helpers are in `tests/ai-fake.ts`. `scripts/qa-live-ai.ts` is the opt-in live check against a real provider and costs money.
- `tests/security-matrix.test.ts` imports every `src/app/api/**/route.ts` via `import.meta.glob`. **A new route or method fails the suite until you add it to the `ACCESS` table** with its allowed roles.
- `tests/security-integrity.test.ts.wip` is parked work and does not run.
- `tests/setup.ts` runs every test inside company 1 (all fixtures build company 1). Raw `new PrismaClient()` fixture writes must set `companyId: 1`, and fixtures that insert `id: 1` into `settings` must `setval` its sequence. `tests/tenancy.db.test.ts` is the cross-company isolation suite.
- Prisma refuses `db push --force-reset` from an AI agent without the user's consent. For a fresh local test DB, create a new database (`CREATE DATABASE …`) and `db push` to it.
- Last full run: 272 passing (`history/` records each session's count).

## Architecture

Request flow: `page.tsx` (client) → `src/lib/client.ts` `api()` / `useApi()` → `src/app/api/**/route.ts` → `src/server/services/*.service.ts` → Prisma (`src/lib/db.ts`).

- **Companies (multi-tenant).** `CompanySettings` (table `settings`) is one row per company, and every other table has a required `companyId`. `src/lib/tenant.ts` keeps the current company in AsyncLocalStorage: `withSession` runs the handler in `runInCompany(session.companyId)`, and `publicRoute` (login, "Create your company") and the session lookup use `runAsSystem`. The client in `src/lib/db.ts` is a Prisma query extension that adds the company to every `where` and every created row (`scopeArgs`). With no context it **throws** (fail closed), so services never filter by company themselves. Still, write `companyId: currentCompanyId()` on creates (the types require it), and look up any client-supplied foreign id (department, leave type…) before writing it, because the lookup is what proves it belongs to the same company. Names, codes, holiday dates and payroll months are unique per company (`companyId_month` etc.). Login email stays globally unique, because sign-in finds the company from it. `POST /api/setup` creates a new company and its Admin (max 5 per network per hour); it never joins an existing one. Prisma queries are lazy, which is why `runInCompany`/`runAsSystem` await `fn` inside the context.

- **Routes stay thin.** Each one is wrapped in `withSession(handler, { roles })` from `src/lib/api.ts`, or `publicRoute` for login/setup. The wrapper resolves the session, blocks users still on a temporary password (unless `allowPasswordChange`), checks the coarse role, parses the body with `readJson(req, zodSchema)` (3 MB cap), and maps errors. `HttpError` keeps its status, `ZodError` becomes 400, and Prisma `P2002`/`P2003` become 409 and `P2025` becomes 404, always with generic messages. A handler can return a plain object (serialized to JSON) or its own `Response` (PDF, CSV).
- **Services are the only code that touches the DB** and hold all business rules. Each takes the `Session` (`src/lib/session.ts`) as its first argument. Data scope is enforced in the service through `scopeEmployeeId(actor, requested)`. An EMPLOYEE is pinned to their own `employeeId`, and asking for another id is a 403 (never a silent swap). Use `assertRole` for finer checks.
- **Auth:** the JWT carries only the user id (`sub`, 8h). Company, role, active state, employee link and `mustChangePassword` are re-read from the DB on every request (`src/lib/auth.ts getSession`). `src/proxy.ts` (the Next 16 replacement for `middleware.ts`) only redirects visitors with no cookie. It is not a security boundary.
- **Writes and audit:** mutations run in `db.$transaction` and call `audit(actor, action, entity, id, {before, after}, tx)` and `notify(userIds, {...}, tx)` from `src/lib/audit.ts` with the same `tx`, so the log entry commits atomically with the change. `audit_logs` is append-only and password hashes are stripped. Leave apply/approve takes a `SELECT … FOR UPDATE` row lock on the employee so concurrent requests can't both pass the balance checks. Decisions only apply to still-PENDING rows.
- **Dates:** calendar dates are ISO strings (`"2026-10-24"`) stored in Postgres `DATE` columns as UTC midnight (`toDate`/`toIso`). "Today", late time and clock times always come from `APP_TZ` (`todayIso`, `localClock`, `zonedDateTime` in `src/lib/dates.ts`). Don't use `new Date()` arithmetic for calendar days. Working days come from `CompanySettings.weekendDays` and the holidays table.
- **Payroll rules** (`payroll.service.ts`): gross = 1.5 × basic, per-day deductions, proration, monthly tax from the annual slab, plus the optional late penalty (`latePenaltyDays`, on only when `CompanySettings.latePenaltyEnabled`). HR creates a draft run per month and Admin finalizes it, which locks it. Payslip PDFs are produced by `src/server/pdf.ts`.
- **Bonus features:** camera check-in rules are the pure `evaluateCameraCheckIn` in `attendance.service.ts` (Haversine in `src/lib/geo.ts`; the browser side is `components/attendance/CameraCheckIn.tsx`, MediaPipe from CDN). Face matching: `FaceProfile` table (never include it in employee responses or audit JSON), `src/lib/face.ts` (distance + 0.55 threshold), `verifyFace` / `enrollFace` / `resetFace` in `attendance.service.ts`, browser descriptors in `components/attendance/faceRecognition.ts` (face-api.js, models from CDN). Attrition risk and anomaly flags are the pure `scoreAttritionRisk` / `detectAnomalies` in `insights.service.ts` over `getDayRows` output. PWA: `app/manifest.ts`, `public/sw.js` (never caches `/api`), registered by `components/shell/PwaRegister.tsx` in production only.

### AI assistant (`src/server/ai/`)
The database is the only source of truth. The model only reads and explains data and never writes.
- `guard.ts guardedAiCall` wraps every AI entry point. It requires an active user, enforces a per-user hourly rate limit and the `AI_TIMEOUT_MS` budget with a friendly fallback, and logs every call to `ai_logs`.
- `chat.ts`: an Agents SDK `Agent` with at most 4 tool rounds and 800 output tokens. The system prompt (`buildChatSystemPrompt`) embeds the role scope, real department names and the policy text from `policy.ts` (business rules plus live settings). The browser sends only `{ conversationId, message }`. History is loaded server-side through `chat-session.ts` (`PrismaChatSession`, which implements the SDK `Session` and is stored in `ChatConversation`/`ChatMessage`), so a client can't inject assistant, system or tool turns. Only plain user/assistant text is persisted, and a failed run writes nothing.
- `tools.ts`: `toolDefsFor(role)` offers the model only that role's tools. `runTool` re-checks the role, validates args with zod, and calls the **same services** the REST API uses. Adding a tool means adding it there with its role list, then covering it in the AI tests.
- `summary.ts` (dashboard bullets) and `smart-leave.ts` (pre-fills the leave form for the user to confirm) use the thin `llm.ts` client in JSON mode with one retry (`json-output.ts`). Summary output is grounded: `ungroundedNumbers` rejects any number that isn't in the KPI JSON.
- `/ai/chat`, `/ai/summary` and `/ai/smart-leave` are rewritten to `/api/ai/*` in `next.config.ts` because the brief names those paths.

### UI
`src/app/(app)/*` holds the signed-in screens inside `layout.tsx` → `components/shell/AppShell.tsx`, which owns the role-based menu. Pages are client components that fetch through `useApi`. Component kits are grouped by area (`components/ops`, `people`, `dashboard`, `ai`, `landing`, `three`, the last being react-three-fiber entry scenes). Dark mode follows the system setting.

## Hosting
Vercel + Neon. Use the pooled `DATABASE_URL` with `&connect_timeout=30` at runtime, and run `prisma db push` once against the **direct** (non-`-pooler`) URL. Set `APP_TZ=Asia/Karachi`.

## History log
`history/` records the work done in each session (see `history/README.md`). **At the end of any session that changes code, add an entry** (`history/YYYY-MM-DD-NN-slug.md`) and a row in the README index. Read the latest entries before starting larger work. They note what's unfinished and what was decided and why.

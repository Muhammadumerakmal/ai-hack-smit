# Company-email sign-up, HR access review, empty states, slow Gemini

- **Date:** 2026-10-28
- **Commits:** see git log
- **Tests:** auth, attendance-leave and tenancy files: 39 passed (2 new). Typecheck and lint clean. Browser checks: gmail sign-up refused under the field; brand-new empty company swept on 23 pages for Admin, HR and an employee with no activity.

## Changes
- **Sign-up needs a company email:** `setupSchema.adminEmail` refuses free personal mailboxes (`PERSONAL_EMAIL_DOMAINS` in `auth.service.ts`: gmail.com, yahoo.com, outlook.com, hotmail.com, icloud.com, …) with "Please use your company email address to sign up.", shown under the field. The setup field is labelled "Company email" with a hint and a you@yourcompany.com placeholder. This applies only to "Create your company"; HR still registers employees with whatever address they use.
- **Empty states:** a brand-new company with one inactive employee showed no `undefined`, `NaN`, `null`, `Invalid Date` or blank KPI/table values on any page, except the audit log "Changes" cell for actions without before/after details (e.g. a password change). That cell now shows `—`.
- **HR access review** (requested: keep Admin and HR separate, especially for payroll and salaries): server and screens already match the brief. HR runs the payroll draft and sets salaries, as Section 2 requires, but can't finalize payroll, change settings, see the audit log or Admin dashboard money data, manage logins, raise their own salary, or approve their own leave. Added the missing test: HR can't decide their own attendance correction.

## Investigated: "the HR assistant doesn't answer"
- Reproduced: answers hit the 15 s limit ("The assistant took too long to answer"). The cause is Gemini latency on this key today: even "Say hi" took 11–22 s, `gemini-flash-latest`/`3.8-flash`/`3.1-flash-lite` returned 503 (high demand), and `2.5-flash-lite` returned 404. The same code passed 14/14 live checks within the limit the day before.
- Tried and reverted: `reasoning_effort`. `none` is rejected by Gemini 3.5 (400 INVALID_ARGUMENT; an earlier "0.8 s" timing was that error, not a fast answer), and `minimal`/`low` aren't faster.

## Open / next
- The owner should decide how to handle the slow provider: wait for Google, use a paid tier, switch back to OpenAI, or raise `AI_TIMEOUT_MS` (the brief asks for 15 s).
- Vercel still needs the Gemini env vars, as noted in the previous entry.

## Follow-up (same day)
- Owner's decisions: keep HR's salary and payroll-draft access as the brief requires, and raise the AI limit to 45 s. `AI_TIMEOUT_MS=45000` is in `.env` and `.env.example` (the code default stays 15 s). The AI routes' `maxDuration` goes from 30 to 60, so the guard's friendly timeout answers before the host cuts the request. README now says the timeout is configurable.
- Check: 5 real HR questions through the app with live Gemini all answered correctly, with sources, in 30–35 s each (Gemini's latency that day). Vercel needs `AI_TIMEOUT_MS=45000` too.

# Demo-script run: off-day check-ins, "who is on leave", Leave page redesign

- **Date:** 2026-10-25
- **Commits:** uncommitted
- **Tests:** npm test: 262 passed (10 new in `tests/offday-leave.db.test.ts`). Lint, typecheck and `next build` clean.

## Changes
- Ran the Section 9 demo script end to end over HTTP on a fresh database (setup → HR → employees → check-in → leave → approval → payroll → finalize → payslip → audit), asked the AI the brief's live test questions, and screenshotted every screen per role at 1440 px and 390 px. No console errors, 5xx responses or horizontal overflow.
- **Fix: check-ins on a weekend or holiday disappeared from "today".** `getDayRows` only has working days, so the dashboard showed Present 0 and the daily board header said "0 of 1 in" while listing the person. New `offDayStatuses` in `attendance.service.ts` adds those records to `getTodaySnapshot` and to the board summary (and classifies board rows the same way). Period rates still use working days only, as Section 7 defines them.
- **Fix: the assistant could not answer "who is on leave this week / next week".** `getLeaveSummary` now returns `onLeaveInPeriod` (approved leave overlapping the period, future periods included, with working days in the period) and `upcomingNext14Days`. The tool description says so, and `dateContext()` gives the model explicit "this week" / "next week" date ranges.
- Fix: "You already have a approved leave" → "an approved leave".
- **Leave page redesign** (`leave/page.tsx`, `SmartLeaveForm.tsx`) on the ops kit: HR inbox with count tabs (Pending / Approved / Rejected / Cancelled / All) and a Review dialog like attendance corrections, an "Away now & upcoming" panel, a balance panel with used/pending bars, responsive `DataList` (cards on phones), and the smart-leave form on the shared `Field`/`Input`/`Button` with clickable example sentences (they only fill the text box).
- `Button` has an `ai` variant (violet), so AI actions don't fight the primary teal classes.
- Employee dashboard: the "This week" card shows hours per day, Monday to Sunday (`week.days` in `getEmployeeDashboard`).

## Decisions
- Off-day records count for "today" and the board only, not for the period's attendance rate, late %, payroll or the late penalty. Section 7's denominator is working-day records, and payroll deducts by working day.
- The inbox loads all statuses at once (the API already caps at 300) so the tabs can show counts without extra requests.

## Open / next
- `tests/biz-perf.db.test.ts` "CSV import of 200 rows" can exceed its 45 s budget when the machine is busy (47 s once with the dev server and a headless browser running; passes alone). On Neon the round trips are much cheaper. Batching the inserts with `createMany` would make it robust if needed.
- Still from session 06/07: the hosted Neon DB needs `npx prisma db push` against the direct URL for `face_profiles` / `attendance.faceVerified`, and it already has a company set up, so the live link opens on login instead of first-run setup. Both touch hosted data and need the owner's go-ahead.

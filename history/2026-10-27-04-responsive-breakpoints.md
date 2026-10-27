# Responsive layout fixes (all screens, 360–1280 px)

- **Date:** 2026-10-27
- **Commits:** most of this landed inside `3b246f2` ("Forms, keyboard and chat accessibility"), because a parallel session committed the whole tree while this work was in progress. The `ui.tsx` Tabs and Users page changes are uncommitted.
- **Tests:** UI-only (class names). `tsc --noEmit` and eslint on the changed files are clean. The full suite was not run.

## How it was checked
Headless Chrome over the DevTools protocol (no new dependency) signed in as admin@, hr@ and sara@demo.test and opened every screen at 360, 390, 768, 1024 and 1280 px. For each page it reported any element past the viewport edge, any sideways-scrolling strip, and a full-page screenshot. No page ever scrolled sideways. The real problems were squeezed or clipped layouts.

## Changes
- **Root cause: `lg` is the narrowest content width.** The sidebar appears at `lg` (1024 px) and takes 256 px, so content gets ~720 px at 1024. Splits that went multi-column at `lg:` were squeezed until 1280. Moved to `xl:`: dashboard trend + late-comers and the 4 admin money KPIs ("Rs / 862,500" wrapped), the Attendance time clock + "at a glance" (the value was cut to "94.…"), the Leave approval inbox + "Away now" (Status and Review were scrolled off), every Employee360 tab (the salary card wrapped its amounts), the Users stat tiles and their filter row, and the dashboard skeleton.
- **Dashboard filter bar** (768–1279 px): the date inputs wrapped one at a time beside the presets into a staggered column. `md:min-w-fit` makes the group move to its own line as a whole.
- **Tab strips wrap instead of scrolling** (`Tabs` in `ui.tsx`, `SegmentedTabs`, Users filter): on phones the last tabs were cut off with no sign that there were more. On Settings that hid "Leave types" and "Holidays".
- `KpiTile` (ops) and the Users `Tile`: label, value and hint wrap instead of `truncate`.

## Decisions
- Moved the splits to `xl` rather than using container queries. It is a smaller change that matches how the codebase already writes breakpoints. If more side-by-side layouts are added, `@container` on `<main>` would be the general fix.

## Open / next
- At exactly 1280 px a long date in "Away now & upcoming" still truncates ("27 Oct 2…") through the shared `PersonCell`, whose truncation is deliberate in tables.
- Dashboard "Today" tiles are 3 + 2 between 640 and 1279 px, leaving one empty slot. This is cosmetic.

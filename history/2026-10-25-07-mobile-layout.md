# Mobile layout for payroll and payslips

- **Date:** 2026-10-25
- **Commits:** see git log ("Mobile layout for payroll, payslips and dashboard")
- **Tests:** npm test: 252 passed (before these UI-only edits). Typecheck and lint clean after them.

## Changes
- Payroll and payslips: below `sm`, each payslip and payroll run is a card instead of an 8-column table. The table is unchanged from `sm` up.
- `fmtMonth` in `src/lib/client.ts` ("2026-10" → "October 2026") for month labels, titles and toasts on both pages.
- Chat button is an icon-only circle on phones (with `aria-label`), and `<main>` has bottom padding so it never covers the last row.
- Dashboard: rate tile labels and bar chart labels wrap instead of truncating; the late-comer bar sits under its subtitle.

## Decisions
- Cards on phones rather than a horizontally scrolling table, because the brief asks for a responsive UI at 375 px and the totals row is unreadable when scrolled.

## Open / next
- The hosted Neon DB still has a company set up, so the live link opens on login rather than first-run setup (Section 9 wants setup). Resetting it deletes all hosted data and needs the owner's explicit go-ahead.
- A native mobile app (optional) is not built.

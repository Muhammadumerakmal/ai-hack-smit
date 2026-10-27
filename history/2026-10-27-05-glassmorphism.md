# Glassmorphism (ui-ux-pro-max), measured contrast, focus and cursor fixes

- **Date:** 2026-10-27
- **Commits:** see git log
- **Tests:** typecheck and lint clean. Styles and config only. Text contrast was measured in headless Chrome on login, dashboard, leave, employees and the chat, in light and dark mode.

## Changes
- **Glassmorphism** from the skill's "Glassmorphism" style (translucent panels, 1px light edge, soft depth, a vibrant field behind). The `glass` and `glass-strong` utilities and their tokens are in `globals.css`. A fixed colour field (teal, violet and sky glows) is painted once behind everything, so the app shell and sign-in page no longer cover it with a solid `bg-background`. Every shared surface (Card, Stat, Panel, Surface, KpiTile, dashboard tiles, announcements) is `glass`. Overlays are `glass-strong`: dialog, menus, notifications, the chat panel, and the sidebar on phones. The header and dashboard filter bar are frosted bars. The sign-in and Create-your-company form is a glass card. The AI summary uses violet-tinted glass.
- **Performance:** only overlays and the sticky bars use `backdrop-filter`. Plain cards sit on the smooth colour field, where a blur makes no visible difference but costs a GPU pass per card. Full-page captures timed out until this changed.
- **Accessibility safeguards** (the skill rates glass "risk: conditional"): panels are 72% opaque in light mode, and `prefers-reduced-transparency` gets solid panels with no blur. **Measured contrast** (real rendered background vs text colour, 534 text elements): every element passes, except one tiny rounded count pill that reads low only because the sample takes in its corners (5.5:1 on paper).
  - Light-mode `zinc-500` is a touch deeper (`--color-zinc-500` on `:root`, unlayered so it overrides Tailwind's layered theme value). Text on the tinted field was 4.3–4.5:1.
  - Primary teal buttons with white text use teal-700, not teal-600 (3.7:1 → 5.5:1). This was a problem before the glass work too.
- **Focus outline bug (app-wide):** the global `:focus-visible` outline was unlayered, so it beat every Tailwind utility and `focus-visible:outline-none` never worked. Components with their own ring showed two rings. It now lives in `@layer base`.
- **Pointer cursor:** Tailwind 4 resets buttons to the default cursor, so `@layer base` gives buttons, tabs, summaries and selects a pointer (skill checklist).
- **Startup warning:** `turbopack.root` is set in `next.config.ts`. A stray `package-lock.json` in the home folder made Next.js guess the wrong root and warn on every start.

## Decisions
- The skill's generated design system suggested blue/orange, Plus Jakarta Sans and a landing-page pattern. Only the glass style and the checklist were used, because the app keeps its teal/violet brand and Geist font, and it is an app, not a landing page. Dark mode stays (it is a brief bonus), although the skill suggests avoiding it for this product.

## Open / next
- Headless full-page screenshots are slow on this machine. Use viewport screenshots for checks.

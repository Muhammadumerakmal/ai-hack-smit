# Performance (lag) and responsive pass

- **Date:** 2026-10-28
- **Commits:** see git log
- **Tests:** typecheck and lint clean; production build. Measured in production on a simulated mid-range phone (390 px, CPU 4× slower). 100 screenshots: 3 roles × every page × 4 widths (390, 768, 1280, 1440).

## Performance
- **Cause of the lag:** the drifting colour orbs (added for the glass look) moved under 8–10 blurred elements per page, so every blur was redrawn on every frame. Production on the simulated phone: dashboard idle 51 fps with 7 dropped frames (up to 133 ms).
- **Fixes:**
  - The orbs stay but no longer move.
  - `glass-control` keeps its look (translucency, rim, sheen, lift) without a backdrop blur. The new `glass-bar` adds the blur only where content scrolls underneath (the header and the dashboard filter bar).
  - Form fields lost their per-field blur.
  - Phones use smaller blur radii (`max-width: 640px`).
- **After:** blurred elements per page went from 8–10 to 2–3. Settled dashboard idle 58 fps, scrolling 50–51 fps at 4× slower CPU; Employees 0 dropped frames at idle. (A CPU profile showed no repeating JavaScript; the remaining early long tasks are the dashboard's first render.)

## Responsive
- 100 screenshots, every page at 4 widths: no horizontal scroll and no console errors at any size. The automatic "clipped" flags were screen-reader-only labels; the "past edge" flag was the time clock's decorative rings, which the card clips on purpose.
- Fixed: the dashboard "Today" tiles left an empty slot (3+2 on tablet, 2+2+1 on phone). They now fill every row: phone 2+2+1 with the last tile full width, tablet 3+2 on a 6-column grid, laptop and desktop 5 in a row. Each span rule is scoped to its range (`max-sm`, `sm:max-xl`).
- Fixed: attendance calendar labels were cut to "Not check…" on tablets; they now wrap to two lines.

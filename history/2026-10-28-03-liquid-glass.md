# Liquid Glass for navigation and controls (ui-ux-pro-max)

- **Date:** 2026-10-28
- **Commits:** see git log
- **Tests:** typecheck and lint clean. Styles only. Measured contrast on login, dashboard and chat, light and dark: 248 text elements, all pass except one label cut off by the viewport edge (a sampling artifact; its fully visible twins pass).

## Changes
- **More glass, following the skill's "liquid-glass" style:** strong glass on navigation and controls, while content keeps a calmer layer for readability.
  - `glass-control` utility (`globals.css`): 20 px blur with 180% saturation, a bright top rim and soft bottom rim (lens edge), a top sheen and a soft lift. Used on the header, the dashboard filter bar, segmented tab strips, Chart/Table toggles, secondary buttons in both kits, the Refresh button, the active sidebar item and the chat composer.
  - Cards (`glass`) get a light diagonal sheen.
  - A drifting orb layer (`body::after`: teal, violet and sky, 48 s, transform-only, so no repaint) sits above the colour field, so the glass always has colour to show.
- **Safeguards:** `prefers-reduced-transparency` gives solid controls with no blur; `prefers-reduced-motion` stops the orbs.

## Decisions
- Kept Liquid Glass to navigation and controls, as the skill's checklist says ("Use for navigation and controls", "Keep content on a separate layer"). Form inputs stay solid for legibility.

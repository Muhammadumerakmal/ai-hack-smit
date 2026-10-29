# Premium glass: light-catching rims, grain, grouped navigation

- **Date:** 2026-10-29
- **Commits:** see git log
- **Tests:** typecheck and lint clean; production build. Contrast re-measured on login, dashboard and chat in light and dark: 274 text elements, all pass except the known viewport-edge sampling artifact.

## Changes
- **Light-catching rim on `glass` cards:** a 1 px gradient edge (brightest top-left) using padding-box/border-box background layers, with no blur and no pseudo-element. Cards keep the outer edge ring, so they stay clearly separate from the background (skill pro-rule "surface readability").
- **Tint slot:** coloured glass sets `--glass-tint` instead of a `bg-*` class, which would replace the layers. The AI summary card uses it.
- **Fine grain** on the colour field (an SVG noise layer, painted once): a premium texture that also hides gradient banding.
- **Grouped sidebar:** Overview · People · Time & leave · Pay · Company, filtered by role, with empty groups hidden. Inactive items hover with glass, and the user card is `glass-control`.

## Glass best practices followed (for future changes)
- Text contrast 4.5:1 on top of glass; measure it, because the backdrop changes it.
- Blur only where content passes behind (header, filter bar, overlays). Never blur many cards over a moving layer.
- Keep a visible edge or ring so surfaces separate from the background in both themes.
- No glass on glass: overlays use `glass-strong`, and content cards stay calmer.
- Honour `prefers-reduced-transparency` (solid panels) and `prefers-reduced-motion`.
- Coloured glass goes through tokens and variables (`--glass-tint`), never ad-hoc backgrounds.

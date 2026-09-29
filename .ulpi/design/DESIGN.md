---
project: TokoBahan POS
register: product
aesthetic_direction: technical / utilitarian
color_strategy: restrained
design_system: Existing Tailwind utility and shared-component system
design_variance: 2
motion_intensity: 1
visual_density: 7
---

## Design Read

Fast, legible merchant operations; favor familiar controls and direct feedback over decorative UI.

## Signature

Search-led product discovery: an operator types a few characters and sees useful product matches immediately, as in the cashier catalog.

## Color (locked)

Preserve the current tokens in `src/index.css`. Primary is the sole interactive accent; secondary/accent are existing supporting brand roles and must not be introduced into this feature without need.

| role | OKLCH | hex | use |
|---|---|---|---|
| background | 98.4% 0.007 97 | #fbfaf5 | Page canvas |
| surface / elevated | 99.4% 0.007 88 | #fffdf8 | Inputs, drawers, suggestions |
| muted | 95.5% 0.010 93 | #f2f0e9 | Quiet supporting surfaces |
| text | 27.7% 0.016 224 | #202a2e | Main copy |
| muted text | 54.0% 0.014 215 | #667174 | Secondary copy |
| subtle border | 91.9% 0.011 89 | #e7e4dc | Dividers and outlines |
| primary accent | 48.5% 0.072 189 | #216c68 | Focus, selected and primary actions |
| secondary | 66.6% 0.157 58 | #d97706 | Existing supporting emphasis |
| accent | 77.2% 0.124 73 | #e4a853 | Existing supporting highlight |
| danger | 63.7% 0.208 25 | #ef4444 | Existing destructive state |
| success | 72.3% 0.192 149 | #22c55e | Existing success state |

Measured WCAG contrast: ink/surface 14.43:1; muted text/surface 4.94:1; primary foreground/primary 5.89:1. Danger and success colors are status fills, not small text colors; pair them with the existing accessible foreground text.

## Type (locked)

| role | family | use | notes |
|---|---|---|---|
| display | Rubik | Page and drawer headings | Existing heading family |
| body | Nunito Sans | Form labels, names and explanatory text | Existing body family |
| utility | Nunito Sans | SKU and compact metadata | Existing family, regular weight |

## Scales (locked)

- Spacing: existing 4px-based Tailwind spacing utilities.
- Radius: use existing `rounded-lg` 8px, `rounded-xl` 12px, and `rounded-2xl` 16px tokens; do not add a new radius scale.
- Motion: no new motion for suggestions; use existing input focus transition. Honor reduced motion if any transition is added.
- Breakpoints: existing Tailwind defaults; keep the drawer's current responsive behavior.
- Focus: retain `Input`'s primary-color outline/ring pattern and visible focus indicators.

## Voice

Register: plain, concise Indonesian. Action vocabulary: use the existing labels and avoid technical wording in visible UI.

## Cross-session consistency

Every screen must read as the same product if placed side by side.

---
project: RAJA Aksesoris POS
register: product
aesthetic_direction: technical / utilitarian
color_strategy: restrained
design_system: Radix UI primitives with the existing Tailwind component layer
design_variance: 3
motion_intensity: 2
visual_density: 6
---

## Design Read

Reliable shop-floor tooling, with spreadsheet-like precision and the existing teal-and-amber shop identity.

## Signature

Use clear column references and a visible three-step worksheet path when handling bulk data. This makes a potentially risky admin operation feel inspectable and grounded in the product's inventory workflow.

## Color (locked)

Keep the existing application palette. Semantic text colors below are darkened variants for accessible labels; preserve semantic meaning and do not add another accent.

| role | OKLCH | hex | use |
|------|-------|-----|-----|
| background | `oklch(0.984 0.044 269)` | `#fbfaf5` | App canvas |
| surface / elevated | `oklch(0.994 0.045 270)` | `#fffdf8` | Forms and content surfaces |
| muted | `oklch(0.955 0.040 269)` | `#f2f0e9` | Quiet inset areas |
| text | `oklch(0.277 0.027 246)` | `#202a2e` | Primary copy |
| muted text | `oklch(0.540 0.038 252)` | `#667174` | Supporting copy |
| border | `oklch(0.919 0.037 270)` | `#e7e4dc` | Dividers and control edges |
| accent (primary) | `oklch(0.485 0.080 207)` | `#216c68` | Primary actions and selected state |
| accent (secondary brand) | `oklch(0.772 0.084 66)` | `#e4a853` | Existing restrained highlights only |
| success text | `oklch(0.448 0.100 162)` | `#166534` | Successful import status |
| warning text | `oklch(0.476 0.081 53)` | `#854d0e` | Warnings and skipped rows |
| danger text | `oklch(0.500 0.169 21)` | `#b42318` | Validation and import errors |
| info text | `oklch(0.450 0.093 234)` | `#155e75` | Neutral instructions |

Contrast against the existing surface `#fffdf8`: ink 14.43:1, muted text 4.94:1, primary 6.06:1, success 7.01:1, warning 6.74:1, danger 6.47:1, and info 7.15:1. Accent gold is decorative only and must not carry small text. Use semantic text colors with surface backgrounds and do not use color as the only error/status signal.

## Type (locked)

| role | family | use | notes |
|------|--------|-----|-------|
| display / headings | Rubik | Page and section headings | Existing project family; medium to bold, compact |
| body | Nunito Sans | Forms, instructions, tables | Existing project family; regular and semibold |
| utility / data | Nunito Sans with tabular numerals | Currency, quantities, row references | Avoid a new typeface |

## Scales (locked)

- Spacing: existing 4px rhythm (`0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64`).
- Radius: existing `sm 8px`, `md 12px`, `lg 16px`; use the smallest appropriate radius for controls.
- Motion: `fast 150ms`, `base 200ms`, `emphasis 300ms`, ease-out; no bounce. Respect `prefers-reduced-motion`.
- Breakpoints: `sm 640px`, `md 768px`, `lg 1024px`, `xl 1280px`.
- Focus: visible 2px primary/accent ring with offset; never remove keyboard focus.

## Voice

- Register: plain, direct Indonesian.
- Action vocabulary: “Unduh template” → “Pilih file” → “Periksa data” → “Impor produk” → “Produk berhasil diimpor”.
- State messages name the affected row or count and explain the next action.

## Cross-session consistency

Every screen must read as the same product if placed side by side.

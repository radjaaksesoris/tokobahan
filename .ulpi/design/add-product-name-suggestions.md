tera# Saran Nama Produk Saat Menambah Produk

**Binds to:** [DESIGN.md](./DESIGN.md)

## Design Read

Pencegahan input ganda harus terasa seperti pencarian kasir: ketik nama, lihat kecocokan dengan cepat, lalu lanjut mengisi tanpa meninggalkan formulir.

**Aesthetic direction:** technical / utilitarian. This is a merchant workflow inside a data-dense POS, so the feature reuses the existing product drawer, input, semantic colors, and typography rather than adding a new visual language. It is specific to the cashier/admin workflow, not a generic promotional autocomplete.

**Counterfactual test:** the search-led matches mirror the existing cashier product search, a workflow-specific behavior rather than a generic dashboard treatment.

## Flow: Check Existing Product Names

**Goal:** Admin sees existing product names similar to the name being entered before saving a new product.

**User story:** As an admin adding a product, I want matching existing names to appear while I type so I can notice a duplicate before creating it.

**Trigger:** Admin opens Tambah Produk and types into Nama Produk.

### Primary flow

```text
Open Tambah Produk
  -> type one or more characters
  -> wait briefly while matching names are searched
  -> show matching product names and optional SKU
  -> admin reviews matches, edits name if needed, and continues normal save flow
```

### Branches and state coverage

| State | Expected behavior |
|---|---|
| Idle / blank | No suggestion panel; the form layout remains unchanged. |
| Searching | Keep focus and typed value in Nama Produk; indicate that matches are loading. |
| Matches | Show a short list of product names, with SKU as secondary metadata when available. Do not make a selection overwrite the form field. |
| No matches | Show a concise “Belum ada nama produk yang cocok.” message; this is informative, not a guarantee that the product can be saved. |
| Search error / offline | Clearly state that matching names could not be checked. Never show an empty-match success state after a failed request. Allow the admin to continue the existing form flow and retain all current save-time validation. |
| Edit product / price-only edit | Do not show the add-only name suggestion behavior. |
| Close or save drawer | Clear transient suggestions and cancel any pending request. Reopening Add Product starts clean. |
| Rapid typing | Debounce requests and discard stale responses so old results cannot replace matches for the latest input. |
| Back / refresh | No draft persistence is added; retain the drawer's current navigation and refresh behavior. |

Match by product name only, case-insensitively, using the same substring matching convention as the cashier search. Limit displayed results to five, ordered by name. Do not let SQL wildcard characters typed by the user broaden the query. Only active products are relevant. This is advisory feedback: existing SKU and all current server-side validation remain authoritative.

## Component: Product Name Match List

### Purpose

Show active product names that contain the text currently typed in Nama Produk while an admin is adding a product.

### Visual and interaction rules

- Place the match list directly below Nama Produk, within the existing product drawer.
- Reuse current `Input`, Tailwind semantic color tokens, spacing and border/radius conventions from [DESIGN.md](./DESIGN.md).
- Each row is static information, not a selectable command: product name first, SKU second when present. Do not provide buttons, hover affordances, or click-to-fill behavior.
- Keep product names readable and wrap long names; avoid truncating the identifying text.
- Show no more than five results. A small result count is optional only if it does not make the form noisy.
- The panel must not shift focus away from the name field or block keyboard access to the rest of the form.

### Accessibility

- Keep the existing label association for Nama Produk.
- Announce loading, result count, no results, and query failure via a polite status region. Do not announce every keystroke; debounce status updates with the search.
- Since entries are informational, use a status/list structure rather than an interactive combobox/listbox.
- Preserve normal Tab order and visible focus ring. Escape may dismiss the suggestion panel without clearing the input.
- Ensure the empty/error text uses readable contrast from the locked tokens.

### Responsive behavior

- At mobile widths, keep the list in the drawer's normal scroll flow, full width, with no horizontal scrolling.
- At tablet and desktop widths, keep the same hierarchy and row layout; do not add columns or a detached overlay.
- Preserve the current safe-area padding and drawer scroll behavior.

### Implementation guidance

- Target: `react-vite-tailwind-engineer` (React + Vite SPA).
- Use the existing Tailwind utilities and shared UI components; no new design-system dependency is needed for this inline informational list.
- Reuse the existing Supabase product-name query patterns where appropriate. The implementation must account for debounce, cancellation/stale results, and explicit error/offline feedback.
- Do not change existing create/edit behavior or weaken SKU/server validation.

## Design Pre-Flight

- [x] Identity lock: existing app tokens and shared input; no off-system visual values proposed.
- [x] Anti-slop: 0 new fonts, palette clichés, generic cards, buzzwords, or decorative motion.
- [x] Counterfactual: reflects the existing cashier's search-led product discovery.
- [x] Signature: immediate, cashier-like matching adapted to the add-product workflow.
- [x] States: idle, loading, matches, empty, error/offline, edit-only exclusion, rapid typing, close/save covered.
- [x] Accessibility: polite status updates, static list semantics, label association, keyboard focus preserved.
- [x] Responsive: drawer flow stays inline on mobile and desktop.
- [x] Cognitive load: one familiar field and a bounded list of five names; no new decision action.
- [x] WCAG pairings: see contrast measurements in [DESIGN.md](./DESIGN.md).
- [x] Reduced motion: no new motion.

**Self-critique (0–4):** distinctiveness 3; hierarchy/focus 4; identity consistency 4; accessibility 4; state/edge coverage 4; copy quality 3; restraint 4; motion motivation 4. **Total: 30/32.** No axis is 2 or lower.

**Revise-and-justify:** Specified the list as informational rather than selectable so it warns about existing names without unexpectedly replacing the value being entered.

## Build Handoff

Implement exactly this spec. Theme the interface with the locked tokens; do not redesign or re-implement existing shared components.

**Target agent:** `react-vite-tailwind-engineer`.

**Acceptance criteria**

- [ ] During Tambah Produk, matching active product names appear as the admin types, with matching semantics consistent with the cashier's substring search.
- [ ] The matching query searches product names only, handles case insensitively, and shows at most five name-ordered matches.
- [ ] Matches are informational; clicking or focusing a row never changes the input value.
- [ ] Blank, loading, results, no-results, query-error/offline, close, edit, and stale-response states are correct.
- [ ] Existing SKU duplicate checks and product saving behavior remain intact.
- [ ] No network request per keystroke; debounce and cancellation/stale-response protection are in place.
- [ ] Appropriate focused tests cover matching, stale requests, and no-results/error behavior.
- [ ] Lint, tests, and build pass.

tera# Saran Nama Produk Saat Menambah Produk

**Binds to:** [DESIGN.md](./DESIGN.md)

## Design Read

Pencegahan input ganda harus terasa seperti pencarian kasir: ketik nama, lihat kecocokan dengan cepat, lalu lanjut mengisi tanpa meninggalkan formulir.

**Aesthetic direction:** technical / utilitarian. This is a merchant workflow inside a data-dense POS, so the feature reuses the existing product drawer, input, semantic colors, and typography rather than adding a new visual language. It is specific to the cashier/admin workflow, not a generic promotional autocomplete.

**Counterfactual test:** the search-led matches mirror the existing cashier product search, a workflow-specific behavior rather than a generic dashboard treatment.

## Flow: Check Existing Product Names

**Goal:** Admin gets plain-text name recommendations while typing and cannot save a new product whose name already exists.

**User story:** As an admin adding a product, I want matching existing names to appear while I type so I can notice a duplicate before creating it.

**Trigger:** Admin opens Tambah Produk and types into Nama Produk.

### Primary flow

```text
Open Tambah Produk
  -> type one or more characters
  -> wait briefly while matching names are searched
  -> show matching product names in a dropdown
  -> admin reviews the recommendations and enters a distinct name
  -> exact duplicate is blocked before save and by database constraint
```

### Branches and state coverage

| State | Expected behavior |
|---|---|
| Idle / blank | No suggestion dropdown; the form layout remains unchanged. |
| Searching | Keep focus and typed value in Nama Produk. Do not show a textual status label; expose loading accessibly without visible copy. |
| Matches | Show up to five matching product names as plain-text dropdown rows. No heading, result-count message, SKU, or other metadata. Recommendations are informational and do not replace the typed value. |
| No matches | Hide the dropdown; do not show an empty-state message. |
| Search error / offline | Do not show a false empty state. Surface the request failure using the app's existing error notification pattern; exact duplicate validation before save remains authoritative. |
| Exact duplicate | Debounce an availability RPC while the admin types. Compare trimmed names case-insensitively and collapse repeated whitespace. Show an inline error below Nama Produk as soon as a duplicate is detected and block save. The duplicate check covers existing records regardless of active status. |
| Corrected name | Clear the duplicate error as soon as the admin edits Nama Produk, then validate the corrected value. |
| Edit product / price-only edit | Do not show the add-only name suggestion behavior. |
| Edit unchanged name | Allow saving when the edited product keeps its own existing name. |
| Close or save drawer | Clear transient suggestions and cancel any pending request. Reopening Add Product starts clean. |
| Rapid typing | Debounce suggestion and duplicate-check requests and discard stale responses so old results cannot replace matches or validation for the latest input. |
| Back / refresh | No draft persistence is added; retain the drawer's current navigation and refresh behavior. |

Recommendations match active product names only, case-insensitively, using the same substring matching convention as the cashier search. Limit displayed recommendations to five, ordered by name. Do not let SQL wildcard characters typed by the user broaden the query. Duplicate validation is separate from the suggestion limit and checks every existing product, active or inactive. Treat names as duplicate when trimming ends, collapsing internal whitespace, and ignoring case yields the same value.

## Component: Product Name Recommendation Dropdown

### Purpose

Show active product names that contain the text currently typed in Nama Produk while an admin is adding a product; prevent saving an exact name duplicate.

### Visual and interaction rules

- Place the recommendation dropdown directly below Nama Produk, aligned to the input width, within the existing product drawer. It should visually attach to the field as a suggestion menu, not resemble a separate information card.
- Reuse current `Input`, Tailwind semantic color tokens, spacing and border/radius conventions from [DESIGN.md](./DESIGN.md).
- Each row contains only the product name as plain text. Never show SKU, result counts, a heading such as “nama produk cocok”, or extra recommendation copy.
- Recommendations are static information, not selectable commands; do not make a row clickable or overwrite the name field.
- Keep product names readable and wrap long names; avoid truncating the identifying text.
- Show no more than five results.
- The panel must not shift focus away from the name field or block keyboard access to the rest of the form.
- When an exact duplicate is detected, show concise inline error text (for example “Nama produk sudah digunakan.”) associated with the input and disable/block form submission.

### Accessibility

- Keep the existing label association for Nama Produk.
- Make the suggestions discoverable as a non-interactive list and expose its presence without visible heading/counter copy. Do not use combobox semantics when rows cannot be selected.
- Announce exact duplicate validation through the associated inline error and input invalid state.
- Do not announce every keystroke; debounce result updates with the search.
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
- Add client-side pre-save exact-name validation and a database-side race-safe guard, preserving existing create/edit behavior and SKU validation. Do not block edits that leave a product's own name unchanged.

## Design Pre-Flight

- [x] Identity lock: existing app tokens and shared input; no off-system visual values proposed.
- [x] Anti-slop: 0 new fonts, palette clichés, generic cards, buzzwords, or decorative motion.
- [x] Counterfactual: reflects the existing cashier's search-led product discovery.
- [x] Signature: immediate, cashier-like matching adapted to the add-product workflow.
- [x] States: idle, loading, matches, empty, error/offline, exact duplicate, edit-only exclusion, rapid typing, close/save covered.
- [x] Accessibility: polite status updates, static list semantics, label association, keyboard focus preserved.
- [x] Responsive: drawer flow stays inline on mobile and desktop.
- [x] Cognitive load: one familiar field and a bounded list of five names; no new decision action.
- [x] WCAG pairings: see contrast measurements in [DESIGN.md](./DESIGN.md).
- [x] Reduced motion: no new motion.

**Self-critique (0–4):** distinctiveness 3; hierarchy/focus 4; identity consistency 4; accessibility 4; state/edge coverage 4; copy quality 3; restraint 4; motion motivation 4. **Total: 30/32.** No axis is 2 or lower.

**Revise-and-justify:** Refined suggestions to plain-text dropdown rows with no SKU or helper heading, matching the requested unobtrusive recommendation behavior. Added case/whitespace-insensitive exact-name validation at both form and database layers so duplicate names cannot be saved.

## Build Handoff

Implement exactly this spec. Theme the interface with the locked tokens; do not redesign or re-implement existing shared components.

**Target agent:** `react-vite-tailwind-engineer`.

**Acceptance criteria**

- [ ] During Tambah Produk, matching active product names appear as a plain-text dropdown as the admin types, with matching semantics consistent with the cashier's substring search.
- [ ] The matching query searches product names only, handles case insensitively, and shows at most five name-ordered matches.
- [ ] The dropdown contains only names; no heading, count, SKU, or extra copy is shown. Recommendations never replace the input value.
- [ ] Blank, loading, results, no-results, query-error/offline, exact-duplicate, close, edit, and stale-response states are correct.
- [ ] Exact duplicate names (case and whitespace normalized) are blocked before save and by a concurrency-safe database guard; an unchanged name remains valid during edit.
- [ ] Existing SKU duplicate checks and product saving behavior remain intact.
- [ ] No network request per keystroke; both suggestions and exact duplicate checks are debounced and protected against stale responses.
- [ ] Appropriate focused tests cover matching, stale requests, and no-results/error behavior.
- [ ] Lint, tests, and build pass.

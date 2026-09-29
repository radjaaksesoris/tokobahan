# Impor master produk dari Excel

> Every screen must read as the same product if placed side by side.
>
> Design Read: Reliable shop-floor tooling, with spreadsheet-like precision and the existing teal-and-amber shop identity.
>
> Aesthetic direction: **technical / utilitarian**. The job is bulk entry of inventory data; the UI should make columns, row locations, and consequences legible rather than decorative. The distinguishing signature is a worksheet-to-stock sequence with row-addressed validation. Counterfactual test: this is specifically a merchant's product/stock import and would not be the same treatment for a generic file uploader.

## Scope and decisions

- Add an import section inside **Pengaturan → Data dasar**, without changing the existing Settings tabs or product-entry flow.
- Download a real `.xlsx` template, fill it, select it, inspect row validation, then import.
- Include product fields, initial stock, HPP, existing vendor, and opening-stock payment terms.
- Insert new products only. A SKU already present or repeated in the workbook is an error; never overwrite existing products.
- Do not create vendor records from the workbook. Vendor names must match existing vendors after trimming and case-insensitive comparison.
- Require internet access. Do not queue a large import offline.
- Validate the full workbook before enabling import. Any invalid row blocks the whole batch so the user can correct the file and retry.
- Persist a batch atomically where practical. If the server cannot guarantee atomicity, the implementation must report exactly which rows committed and must not describe a partially completed batch as fully successful.
- Do not include category or image fields: category is not exposed in the current product form and product image upload is outside this workflow.

## Flow: preparing and importing products

### Goal and user story

As an administrator, I want to fill a downloadable Excel template and upload it once, so I can add many products and their starting stock faster than entering each product individually.

### Entry and prerequisites

- Entry point: Pengaturan → Data dasar → section “Impor master produk”.
- User must be authenticated as the admin already admitted by the app.
- For a positive opening quantity, the row needs an existing vendor. All rows include a vendor name to stay consistent with the current product-create form.
- Import is online-only; disable the upload/import action and explain why when `navigator.onLine` is false.

### Primary journey

```text
Pengaturan / Data dasar
  → Unduh template Excel
  → Isi rows in the Produk sheet
  → Pilih .xlsx
  → Parse and validate the whole workbook
      ├─ errors: show row/column issues; keep import disabled
      └─ valid: show review summary and first rows
  → Impor produk
      ├─ success: show imported count; refresh relevant product/vendor data
      └─ failure: show explicit error and preserve the selected file for correction/retry
```

### Template workbook contract

Generate one `.xlsx` workbook with:

1. `Produk` as the only importable data sheet. Row 1 contains the exact headers below. The sheet has no fake product row; put an example in the separate `Panduan` sheet so sample data cannot be imported accidentally.
2. `Panduan` gives Indonesian descriptions, required/optional status, accepted values, and one clearly labeled example row. Freeze the header row and enable filters on `Produk`.

`Produk` columns, in order:

| Header | Required | Meaning and validation |
|---|---:|---|
| `nama_produk` | yes | Trimmed, non-empty product name |
| `sku` | yes | Trimmed, non-empty; unique within file and against existing products, case-insensitive |
| `barcode` | no | Text, preserve leading zeroes |
| `satuan_stok` | yes | Built-in or existing custom unit |
| `stok_awal` | yes | Number >= 0; blank invalid |
| `stok_minimum` | yes | Number >= 0 |
| `harga_modal` | yes | Number > 0, matching the existing product form |
| `satuan_modal` | yes | Built-in or existing custom unit |
| `konversi_modal` | yes | Number > 0 |
| `satuan_dasar` | yes | `pcs` or `meter` |
| `vendor` | yes | Existing vendor name, case-insensitive match |
| `status_bayar_awal` | yes | `lunas` or `kredit` |
| `jatuh_tempo` | conditional | Required as Excel date when opening stock is positive and status is `kredit`; otherwise blank |
| `harga_jual_1` | yes | Number > 0 |
| `satuan_jual_1` | yes | Built-in or existing custom unit |
| `konversi_jual_1` | yes | Number > 0 |
| `harga_jual_2` ... `harga_jual_5` | no | Optional price tiers; each set is either entirely empty or complete |
| `satuan_jual_2` ... `satuan_jual_5` | conditional | Required if corresponding price tier is supplied |
| `konversi_jual_2` ... `konversi_jual_5` | conditional | Required and > 0 if corresponding price tier is supplied |

Store SKU and barcode as text in the workbook; do not coerce them to numbers. Conversions and quantities may use decimal values consistent with the application. Give the sheet clear in-cell/date help, but validation must run again on upload because workbook authoring tools may remove Excel validation rules.

### Upload/review behavior

- Accept `.xlsx` only. Reject files that are empty, over 10 MB, contain no `Produk` sheet, contain malformed workbook data, or have more than 500 non-empty product rows.
- Ignore completely empty rows. Report the actual worksheet row number, starting at 2.
- Normalize cell whitespace. Match units and vendors case-insensitively against freshly loaded reference data, but save the canonical names/units from the database.
- Detect missing/renamed headers; never guess column meanings. Extra columns may be ignored but must be disclosed in the review summary.
- Check SKU duplicates against both existing products (all records, not only the current page) and other non-empty rows in the workbook.
- Confirm valid payment status, numeric values, date validity, required values, duplicate selling-unit rows, and credit due dates.
- Before import, show file name, count of product rows, count of rows with positive opening stock, and a preview of the first 10 rows. Do not sum quantities across unlike units. Provide a compact “N baris lainnya” note when more exist.
- Validation errors appear in a table with columns: Excel-Zeile, Feld, Wert, Masalah. Keep the file selected and block import until all errors are corrected/reselected. Use text and icons in addition to color.
- When valid, show exactly one primary CTA: “Impor N produk”. Secondary action: “Pilih file lain”.
- While importing, disable duplicate submission and announce progress. Show imported count if progress can be measured. Do not present a success toast until persistence is confirmed.
- After success, show imported count and that product entries are new, clear the upload state, and offer a link/button to Produk.

## Component specifications

### `ProductImportSection`

- Purpose: template download and entry point for product workbook imports in the Data dasar tab.
- Composition: one quiet section heading and short instruction, a three-step inline sequence (`Unduh template`, `Isi data`, `Upload & periksa`), a secondary template-download button, then a file drop/select control. Do not use three equal cards; sequence should be a compact horizontal step rail on wide screens and a vertical ordered list on narrow screens.
- File control: native file input hidden behind a labeled, keyboard-operable “Pilih file Excel” button or drop target. Drag and drop is optional, never the only input method.
- States: idle, parsing, invalid extension/size, workbook parse failure, validation errors, ready-to-import, importing, import failure/partial failure, success, offline.
- On a new selection, discard prior validation and preview immediately. On parse error, preserve the filename and actionable error. On network loss during parsing/review, do not lose the file; block import and explain retry when online.
- Responsive: full-width section; preview becomes horizontally scrollable on mobile, with row errors readable without requiring hover. Touch targets at least 44px.
- Accessibility: section heading, `aria-describedby` instructions, labeled input accepting `.xlsx`, `aria-live="polite"` for parse/import progress and result, `aria-live="assertive"` or focused error summary on validation failure. Keep keyboard order download → file chooser → review → import. Focus the validation summary when errors first appear.

### `ProductImportReview`

- Purpose: establish trust in what will be imported and make corrections easy in Excel.
- Render a data table with textual row index, SKU, product name, opening stock/unit, vendor, opening-payment state, and outcome. Keep full field errors in a separate expandable/error list if needed; no error hidden behind hover.
- Use existing `Card`, `Button`, `Input`/table patterns and theme classes. Do not create a new dialog system.
- Row refs use “Baris 12” and field labels, not only column letters. Announce totals and errors in text.

## States and error recovery

| State/error | User feedback | Recovery |
|---|---|---|
| No file | Short instruction and template CTA | Download template or select a workbook |
| Parsing | “Memeriksa file…” and disabled actions | Wait; allow cancel/replace if parsing can be aborted safely |
| Wrong extension/too large | Explain `.xlsx` and 10 MB limit | Choose another file |
| Missing sheet/header/malformed | Name the missing sheet/header or parse problem | Correct template and upload again |
| Validation errors | Row + field + offending value + reason; import disabled | Correct workbook and reselect |
| Duplicate SKU | Identify duplicate row(s) and existing SKU; never overwrite | Choose unique SKU |
| Offline before import | Explain online requirement; preserve review | Retry when connected |
| Session expired/permission denied | Explain session/access problem; do not retry silently | Sign in as admin |
| Backend failure | Show explicit server message with imported/failed counts if any | Retry only safe, non-duplicating rows |
| Success | Confirm count and clear file state | Go to product list |

## Data and persistence requirements

- Map product values to the current `products` schema: `name`, `sku`, `barcode`, `cost_price`, `cost_unit`, `cost_conversion`, `stock_unit`, `stock_conversion`, `stock`, `min_stock`, `unit_base`, `prices`, `is_active`.
- Build `prices` as the application's JSON array `{ unit, price, conversion }`; require tier 1 and preserve tiers in supplied order.
- Create opening-stock FIFO batch via the existing stock receipt contract when `stok_awal > 0`, with matched `vendor_id`, `status_bayar_awal`, and due date. Never write opening quantity only to `products.stock` if that bypasses stock-batch accounting.
- Reset/app cache must be refreshed or invalidated after successful import so new products appear immediately.
- Use an admin-authorized persistence path. Prefer a transaction/batch RPC that validates and inserts all rows atomically and safely handles duplicate SKUs. The row-level security and function security-definer rules must be preserved. If the existing backend does not support a safe atomic batch, implement bounded per-row writes and return a row-by-row outcome; do not hide partial commits or assume rollback across client calls.
- Retain an idempotency strategy or recheck SKUs server-side to prevent double-submit and concurrent imports from duplicating products.

## Accessibility and visual rules

- Bind all colors, type, spacing, radius, and motion to `.ulpi/design/DESIGN.md`.
- Minimum contrast: 4.5:1 for text and 3:1 for UI boundaries. Do not use the existing gold accent for small text.
- Table headings are semantic `<th scope="col">`; validation errors are programmatically associated with the file/review area.
- All actions have visible focus, Enter/Space activation, and descriptive accessible names.
- Honor reduced-motion preference. No motion is required beyond a brief progress indicator.
- “Tidak ada error” must be stated explicitly when valid; do not rely on green color alone.

## Build handoff

- **Target agent:** `react-vite-tailwind-engineer` equivalent; implement in the existing React + Vite + Tailwind application.
- **Design system:** Radix UI primitives with the existing Tailwind component layer. Use existing project `Button`, `Card`, and `Input`; use an established accessible primitive only if a non-native control is actually needed. Do not introduce another visual system.
- **Workbook library:** inspect current dependency state first. Add a maintained browser-compatible `.xlsx` library only if needed; keep parsing client-side and enforce file/row limits before expensive operations.
- **Likely surfaces:** `src/pages/Settings.tsx`, a focused import component/helper under `src/components` or `src/lib`, unit tests, and a Supabase migration only if needed for safe atomic persistence. Read the locked `DESIGN.md` first.
- Implement exactly this spec. Theme the design system with our locked tokens; do not redesign or re-implement its components.

### Acceptance criteria

- [ ] Admin can download a valid `.xlsx` template and understand every supported field from its `Panduan` sheet.
- [ ] Excel data sheet contains only headers and blank entry rows; the example cannot accidentally be imported.
- [ ] Upload validates headers, required values, units/vendors, dates, numeric bounds, SKU uniqueness, workbook size, and row count.
- [ ] Any validation error blocks import and identifies exact Excel row, field, value, and correction.
- [ ] Import creates only new products; duplicate SKUs never overwrite existing records.
- [ ] Positive opening stock is stored through the FIFO/vendor/payment-aware stock-receipt path.
- [ ] Persistence errors and partial outcomes are explicit; duplicate submission cannot silently create duplicate products.
- [ ] Offline state disables import while retaining the selected workbook/review.
- [ ] Success refreshes relevant product data and provides a path to the Products page.
- [ ] Keyboard and screen-reader flow works; mobile review is usable at 320px width.
- [ ] Unit tests cover valid workbook, malformed/missing headers, empty rows, repeated/existing SKU, invalid units/vendor/date/prices, zero opening stock, and positive opening stock.
- [ ] Lint and production frontend build pass; database tests or migration verification run if backend code changes.

## Pre-Flight

- Identity lock: all visuals use the existing RAJA teal/amber palette, Rubik/Nunito Sans, current 4px spacing rhythm, and project controls. Off-system values: 0.
- Anti-slop: 0 banned fonts, gradients, fake filler, or decorative status dots. No repeated card grid. Spreadsheet column/row references are the task-specific signature.
- State coverage: idle, parse, validation, ready, importing, offline, backend failure, partial failure, success, and file replacement are specified.
- Accessibility: contrast pairs are listed in `DESIGN.md`; keyboard order, focus, semantic table headings, live announcements, and non-color error messaging are specified.
- Layout: existing Settings tab/header plus a sequence rail, file-control area, and table-first review provide distinct structural families without adding equal feature cards.
- Cognitive load: one primary import action, progressive disclosure for error details, and no more than three explicit workflow steps.
- Scored critique (0–4): distinctiveness 3, hierarchy/focus 3, consistency 4, accessibility 3, state/edge coverage 4, copy quality 3, restraint 4, motion motivation 4. **Total: 28/32.** No axis is 2 or lower.
- Revise-and-justify: used a separate guide sheet instead of an example data row to prevent importing sample products; blocked imports with any validation error to prevent ambiguous partial intent.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertCircle, CheckCircle2, Download, FileSpreadsheet, Info, Upload } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { UNIT_LABELS } from '@/types'
import type { Json } from '@/types/database'
import { clearCachedProductLists } from '@/lib/offlineCache'
import {
  createProductImportTemplate,
  parseProductWorkbook,
  PRODUCT_IMPORT_MAX_FILE_SIZE,
  PRODUCT_IMPORT_MAX_ROWS,
  type ProductImportIssue,
  type ProductImportRow,
  type ProductImportValidation,
} from '@/lib/productImport'
import { supabase } from '@/lib/supabase'

const MAX_REFERENCE_PAGE = 1000
const XLSX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

async function loadImportReferences() {
  const [vendorsResult, unitsResult] = await Promise.all([
    supabase.from('vendors').select('id, name').order('name'),
    supabase.from('custom_units').select('name').order('name'),
  ])
  if (vendorsResult.error) throw new Error(`Gagal memuat daftar vendor: ${vendorsResult.error.message}`)
  if (unitsResult.error) throw new Error(`Gagal memuat daftar satuan: ${unitsResult.error.message}`)

  const existingSkus: string[] = []
  for (let offset = 0; ; offset += MAX_REFERENCE_PAGE) {
    const { data, error } = await supabase
      .from('products')
      .select('sku')
      .order('id')
      .range(offset, offset + MAX_REFERENCE_PAGE - 1)
    if (error) throw new Error(`Gagal memeriksa SKU produk yang sudah ada: ${error.message}`)
    const page = data || []
    existingSkus.push(...page.flatMap((product) => product.sku ? [product.sku] : []))
    if (page.length < MAX_REFERENCE_PAGE) break
  }

  return {
    vendors: vendorsResult.data || [],
    units: [...Object.keys(UNIT_LABELS), ...(unitsResult.data || []).map((unit) => unit.name)],
    existingSkus,
  }
}

function issueDescription(issue: ProductImportIssue) {
  return issue.message
}

function formatQuantity(value: number) {
  return new Intl.NumberFormat('id-ID', { maximumFractionDigits: 4 }).format(value)
}

function createIdempotencyKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  if (typeof crypto === 'undefined' || !crypto.getRandomValues) {
    throw new Error('Browser ini tidak mendukung pembuatan kunci impor yang aman.')
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function ProductImportSection() {
  const inputRef = useRef<HTMLInputElement>(null)
  const validationSummaryRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<File | null>(null)
  const [isOnline, setIsOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [validation, setValidation] = useState<ProductImportValidation | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [parsing, setParsing] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [successCount, setSuccessCount] = useState<number | null>(null)
  const [templateLoading, setTemplateLoading] = useState(false)
  const [idempotencyKey, setIdempotencyKey] = useState('')

  const validationErrors = validation?.issues || []
  const readyRows = validation?.rows || []
  const canImport = Boolean(
    selectedFile && validation && validationErrors.length === 0 && readyRows.length > 0 && isOnline && !parsing && !importing,
  )

  const parseSelectedFile = useCallback(async (file: File) => {
    setParsing(false)
    setValidation(null)
    setParseError(null)
    setImportError(null)
    if (!file.name.toLocaleLowerCase().endsWith('.xlsx')) {
      setParseError('Pilih file dengan format .xlsx. File CSV, .xls, dan format lain tidak didukung.')
      return
    }
    if (file.size === 0) {
      setParseError('File kosong. Pilih workbook .xlsx yang berisi lembar Produk.')
      return
    }
    if (file.size > PRODUCT_IMPORT_MAX_FILE_SIZE) {
      setParseError('Ukuran file melebihi batas 10 MB. Pecah data menjadi file yang lebih kecil.')
      return
    }
    if (!navigator.onLine) {
      setParseError('Perlu koneksi internet untuk memeriksa data produk terbaru. File tetap dipilih; coba lagi saat online.')
      return
    }

    setParsing(true)
    try {
      const references = await loadImportReferences()
      if (!navigator.onLine) {
        setParseError('Koneksi terputus saat memeriksa daftar produk, vendor, dan satuan. File tetap dipilih; coba lagi saat online.')
        return
      }
      const result = await parseProductWorkbook(await file.arrayBuffer(), references)
      setValidation(result)
      if (result.issues.length === 0 && result.rows.length === 0) {
        setParseError('Tidak ada produk yang siap diimpor.')
      }
    } catch (error) {
      setParseError(!navigator.onLine
        ? 'Koneksi terputus saat memeriksa data. File tetap dipilih; coba lagi saat online.'
        : error instanceof Error
          ? `Workbook tidak dapat dibaca atau data acuan gagal dimuat: ${error.message}`
          : 'Workbook tidak dapat dibaca. Pastikan file .xlsx tidak rusak.')
    } finally {
      setParsing(false)
    }
  }, [])

  useEffect(() => {
    const updateConnection = () => setIsOnline(navigator.onLine)
    window.addEventListener('online', updateConnection)
    window.addEventListener('offline', updateConnection)
    return () => {
      window.removeEventListener('online', updateConnection)
      window.removeEventListener('offline', updateConnection)
    }
  }, [])

  useEffect(() => {
    if (isOnline && fileRef.current && (parseError?.includes('internet') || parseError?.includes('terputus'))) {
      void parseSelectedFile(fileRef.current)
    }
  }, [isOnline, parseError, parseSelectedFile])

  useEffect(() => {
    if (validationErrors.length > 0) validationSummaryRef.current?.focus()
  }, [validationErrors.length])

  async function downloadTemplate() {
    setTemplateLoading(true)
    try {
      const data = await createProductImportTemplate()
      const blob = new Blob([new Uint8Array(data)], { type: XLSX_MIME_TYPE })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = 'template-impor-master-produk.xlsx'
      anchor.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (error) {
      setParseError(error instanceof Error ? error.message : 'Template Excel gagal dibuat.')
    } finally {
      setTemplateLoading(false)
    }
  }

  function selectFile(file: File | undefined) {
    if (!file) return
    fileRef.current = file
    setSelectedFile(file)
    setValidation(null)
    setParseError(null)
    setImportError(null)
    setSuccessCount(null)
    setIdempotencyKey(createIdempotencyKey())
    void parseSelectedFile(file)
  }

  async function importProducts() {
    if (!canImport || !idempotencyKey) return
    setImporting(true)
    setImportError(null)
    try {
      const rows = readyRows as ProductImportRow[]
      const { data, error } = await supabase.rpc('import_master_products', {
        p_rows: rows as unknown as Json,
        p_idempotency_key: idempotencyKey,
      })
      if (error) throw new Error(error.message)
      const result = data as { imported_count?: number } | null
      const importedCount = Number(result?.imported_count)
      if (!Number.isInteger(importedCount) || importedCount !== rows.length) {
        throw new Error('Server tidak mengonfirmasi jumlah produk yang sama dengan permintaan. Periksa kembali daftar produk sebelum mengulangi impor.')
      }
      clearCachedProductLists()
      setSuccessCount(importedCount)
      setSelectedFile(null)
      fileRef.current = null
      setValidation(null)
      setParseError(null)
      setImportError(null)
      setIdempotencyKey('')
      if (inputRef.current) inputRef.current.value = ''
    } catch (error) {
      setImportError(
        `Server belum mengonfirmasi hasil impor: ${error instanceof Error ? error.message : 'Impor gagal.'} Jangan menganggap impor berhasil. Jika koneksi terputus, ulangi dengan tombol yang sama agar hasil yang mungkin sudah tersimpan tidak digandakan. Jika ada pesan validasi, perbaiki workbook lalu pilih file kembali.`,
      )
    } finally {
      setImporting(false)
    }
  }

  const reviewSummary = validation && validationErrors.length === 0
  const firstRows = readyRows.slice(0, 10)
  const rowsWithOpeningStock = readyRows.filter((row) => row.opening_stock > 0).length

  return (
    <Card aria-labelledby="product-import-heading">
      <CardHeader>
        <CardTitle id="product-import-heading" className="text-base">Impor master produk</CardTitle>
        <p id="product-import-instructions" className="text-sm text-muted-foreground">
          Tambahkan produk baru beserta stok awal dari Excel. SKU yang sudah digunakan tidak akan ditimpa.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        <ol className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-3" aria-label="Langkah impor produk">
          {['Unduh template', 'Isi data', 'Upload & periksa'].map((step, index) => (
            <li key={step} className="flex min-h-11 items-center gap-3 border-l-2 border-border pl-3 sm:border-l-0 sm:border-t-2 sm:pl-0 sm:pt-2">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted font-semibold tabular-nums text-ink" aria-hidden="true">
                {index + 1}
              </span>
              <span className="font-semibold text-ink">{step}</span>
            </li>
          ))}
        </ol>

        <div className="flex flex-col gap-3 rounded-xl border border-border bg-muted/50 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <FileSpreadsheet className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">
              Gunakan lembar <strong className="text-ink">Produk</strong> untuk data impor dan lembar <strong className="text-ink">Panduan</strong> untuk penjelasan kolom serta contoh.
            </p>
          </div>
          <Button type="button" variant="outline" className="min-h-11 shrink-0" disabled={templateLoading} onClick={() => void downloadTemplate()}>
            <Download className="h-4 w-4" aria-hidden="true" />
            {templateLoading ? 'Menyiapkan template…' : 'Unduh template Excel'}
          </Button>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            ref={inputRef}
            id="product-import-file"
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="sr-only"
            tabIndex={-1}
            aria-label="Pilih file Excel .xlsx"
            aria-describedby={`product-import-instructions product-import-file-help${validationErrors.length > 0 ? ' product-import-error-summary' : ''}`}
            aria-invalid={validationErrors.length > 0}
            aria-errormessage={validationErrors.length > 0 ? 'product-import-error-summary' : undefined}
            disabled={!isOnline || parsing || importing}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0]
              event.currentTarget.value = ''
              selectFile(file)
            }}
          />
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            disabled={!isOnline || parsing || importing}
            onClick={() => inputRef.current?.click()}
          >
            <Upload className="h-4 w-4" aria-hidden="true" />
            {selectedFile ? 'Pilih file lain' : 'Pilih file Excel'}
          </Button>
          <p id="product-import-file-help" className="text-sm text-muted-foreground">
            Format .xlsx, maksimal 10 MB dan 500 baris produk.
          </p>
        </div>

        {!isOnline && (
          <p className="flex items-start gap-2 rounded-lg border border-cyan-800/20 bg-cyan-50 p-3 text-sm text-cyan-900" role="status">
            <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            Impor memerlukan koneksi internet. File dan hasil pemeriksaan tetap disimpan di layar; impor aktif kembali saat online.
          </p>
        )}

        <div className="min-h-5 text-sm" aria-live="polite" aria-atomic="true">
          {parsing && <p role="status">Memeriksa file, SKU, vendor, dan satuan…</p>}
          {parseError && !parsing && <p className="flex items-start gap-2 text-red-800"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{parseError}</p>}
        </div>

        {selectedFile && !parsing && (
          <section aria-labelledby="product-import-review-heading" className="space-y-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-3">
              <div>
                <h4 id="product-import-review-heading" className="font-semibold text-ink">Periksa data</h4>
                <p className="break-all text-sm text-muted-foreground">{selectedFile.name}</p>
              </div>
              {validation && <p className="text-sm tabular-nums text-muted-foreground">{validation.nonEmptyRows} baris produk</p>}
            </div>

            {validationErrors.length > 0 && (
              <div id="product-import-error-summary" ref={validationSummaryRef} tabIndex={-1} className="space-y-2 rounded-xl border border-red-300 bg-red-50 p-4 outline-none focus-visible:ring-2 focus-visible:ring-red-700" aria-live="assertive">
                <h5 className="flex items-center gap-2 font-semibold text-red-900">
                  <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {validationErrors.length} masalah ditemukan — impor diblokir
                </h5>
                <p className="text-sm text-red-900">Perbaiki nilai pada workbook lalu pilih kembali file. Tidak ada produk yang diimpor.</p>
                <div className="overflow-x-auto rounded-lg border border-red-200 bg-surface">
                  <table className="w-full min-w-[650px] text-left text-sm">
                    <thead className="bg-red-100 text-red-950">
                      <tr>
                        <th scope="col" className="px-3 py-2">Baris Excel</th>
                        <th scope="col" className="px-3 py-2">Kolom</th>
                        <th scope="col" className="px-3 py-2">Nilai</th>
                        <th scope="col" className="px-3 py-2">Masalah</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {validationErrors.map((issue, index) => (
                        <tr key={`${issue.row}-${issue.field}-${index}`} className="align-top">
                          <td className="whitespace-nowrap px-3 py-2 font-semibold">{issue.row ? `Baris ${issue.row}` : '—'}</td>
                          <td className="px-3 py-2">{issue.field}</td>
                          <td className="max-w-48 break-words px-3 py-2">{issue.value || 'Kosong'}</td>
                          <td className="min-w-64 px-3 py-2">{issueDescription(issue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {validation && validation.extraColumns.length > 0 && (
              <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                Kolom tambahan diabaikan: {validation.extraColumns.join(', ')}.
              </p>
            )}

            {reviewSummary && (
              <>
                <p className="flex items-center gap-2 text-sm font-semibold text-green-800" role="status">
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                  Tidak ada error. {readyRows.length} produk baru siap ditinjau.
                </p>
                <dl className="grid gap-3 rounded-xl bg-muted/60 p-3 text-sm sm:grid-cols-3">
                  <div><dt className="text-muted-foreground">Nama file</dt><dd className="break-all font-medium text-ink">{selectedFile.name}</dd></div>
                  <div><dt className="text-muted-foreground">Jumlah produk</dt><dd className="font-semibold tabular-nums text-ink">{readyRows.length}</dd></div>
                  <div><dt className="text-muted-foreground">Produk dengan stok awal</dt><dd className="font-semibold tabular-nums text-ink">{rowsWithOpeningStock}</dd></div>
                </dl>
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full min-w-[720px] text-left text-sm">
                    <thead className="bg-primary text-primary-foreground">
                      <tr>
                        {['Baris Excel', 'SKU', 'Nama produk', 'Stok awal', 'Vendor', 'Pembayaran', 'Hasil'].map((heading) => (
                          <th key={heading} scope="col" className="whitespace-nowrap px-3 py-2">{heading}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {firstRows.map((row) => (
                        <tr key={row.excel_row}>
                          <td className="px-3 py-2 font-medium">Baris {row.excel_row}</td>
                          <td className="px-3 py-2">{row.sku}</td>
                          <td className="px-3 py-2">{row.name}</td>
                          <td className="px-3 py-2 tabular-nums">{formatQuantity(row.opening_stock)} {row.stock_unit}</td>
                          <td className="px-3 py-2">{row.vendor_name}</td>
                          <td className="px-3 py-2">{row.payment_status}</td>
                          <td className="px-3 py-2 font-medium text-green-800">Produk baru</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {readyRows.length > 10 && <p className="text-sm text-muted-foreground">{readyRows.length - 10} baris lainnya tidak ditampilkan.</p>}
              </>
            )}

            {importError && <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900" role="alert">{importError}</p>}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              {reviewSummary && (
                <Button type="button" className="min-h-11" disabled={!canImport} onClick={() => void importProducts()}>
                  {importing ? 'Mengimpor produk…' : `Impor ${readyRows.length} produk`}
                </Button>
              )}
            </div>
            {importing && <p className="text-sm text-muted-foreground" role="status">Menyimpan seluruh batch secara atomik. Jangan tutup halaman sampai server mengonfirmasi hasilnya.</p>}
          </section>
        )}

        {successCount !== null && (
          <div className="flex flex-col gap-3 rounded-xl border border-green-300 bg-green-50 p-4 sm:flex-row sm:items-center sm:justify-between" role="status" aria-live="polite">
            <p className="flex items-start gap-2 font-medium text-green-900">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
              {successCount} produk baru berhasil diimpor. Data produk telah diperbarui.
            </p>
            <Link to="/products" className="inline-flex min-h-11 items-center font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">
              Buka Produk
            </Link>
          </div>
        )}
        <span className="sr-only">{PRODUCT_IMPORT_MAX_ROWS} baris produk maksimum</span>
      </CardContent>
    </Card>
  )
}

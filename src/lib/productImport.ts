import type ExcelJS from 'exceljs'
import { UNIT_LABELS, type ProductPrice } from '@/types'

export const PRODUCT_IMPORT_MAX_FILE_SIZE = 10 * 1024 * 1024
export const PRODUCT_IMPORT_MAX_ROWS = 500

export const PRODUCT_IMPORT_HEADERS = [
  'nama_produk',
  'sku',
  'barcode',
  'satuan_stok',
  'stok_awal',
  'stok_minimum',
  'harga_modal',
  'satuan_modal',
  'konversi_modal',
  'satuan_dasar',
  'vendor',
  'status_bayar_awal',
  'jatuh_tempo',
  'harga_jual_1',
  'satuan_jual_1',
  'konversi_jual_1',
  'harga_jual_2',
  'satuan_jual_2',
  'konversi_jual_2',
  'harga_jual_3',
  'satuan_jual_3',
  'konversi_jual_3',
  'harga_jual_4',
  'satuan_jual_4',
  'konversi_jual_4',
  'harga_jual_5',
  'satuan_jual_5',
  'konversi_jual_5',
] as const

const FIELD_LABELS: Record<string, string> = {
  nama_produk: 'Nama produk',
  sku: 'SKU',
  barcode: 'Barcode',
  satuan_stok: 'Satuan stok',
  stok_awal: 'Stok awal',
  stok_minimum: 'Stok minimum',
  harga_modal: 'Harga modal',
  satuan_modal: 'Satuan modal',
  konversi_modal: 'Konversi modal',
  satuan_dasar: 'Satuan dasar',
  vendor: 'Vendor',
  status_bayar_awal: 'Status bayar awal',
  jatuh_tempo: 'Jatuh tempo',
  harga_jual_1: 'Harga jual 1',
  satuan_jual_1: 'Satuan jual 1',
  konversi_jual_1: 'Konversi jual 1',
  harga_jual_2: 'Harga jual 2',
  satuan_jual_2: 'Satuan jual 2',
  konversi_jual_2: 'Konversi jual 2',
  harga_jual_3: 'Harga jual 3',
  satuan_jual_3: 'Satuan jual 3',
  konversi_jual_3: 'Konversi jual 3',
  harga_jual_4: 'Harga jual 4',
  satuan_jual_4: 'Satuan jual 4',
  konversi_jual_4: 'Konversi jual 4',
  harga_jual_5: 'Harga jual 5',
  satuan_jual_5: 'Satuan jual 5',
  konversi_jual_5: 'Konversi jual 5',
}

const REQUIRED_FIELDS = [
  ...PRODUCT_IMPORT_HEADERS.slice(0, 12),
  ...PRODUCT_IMPORT_HEADERS.slice(13, 16),
]

const FIELD_DESCRIPTIONS: Record<string, string> = {
  nama_produk: 'Nama produk yang ditampilkan di katalog.',
  sku: 'Kode produk unik. Simpan sebagai teks; tidak boleh sama dengan produk lain.',
  barcode: 'Opsional. Simpan sebagai teks agar angka nol di depan tidak hilang.',
  satuan_stok: 'Satuan pencatatan stok: satuan, lusin, kodi, gross, meter, pack, atau satuan khusus yang sudah dibuat.',
  stok_awal: 'Jumlah stok pertama dalam satuan stok. Angka nol diperbolehkan.',
  stok_minimum: 'Batas untuk peringatan stok menipis.',
  harga_modal: 'Harga modal per satuan modal; harus lebih dari nol.',
  satuan_modal: 'Satuan harga modal: satuan bawaan atau satuan khusus yang sudah dibuat.',
  konversi_modal: 'Jumlah satuan dasar yang diwakili satu satuan modal; harus lebih dari nol.',
  satuan_dasar: 'Pilih pcs atau meter.',
  vendor: 'Nama vendor yang sudah tersimpan. Nama dicocokkan tanpa membedakan huruf besar/kecil.',
  status_bayar_awal: 'Pilih lunas atau kredit.',
  jatuh_tempo: 'Tanggal Excel wajib diisi jika stok awal lebih dari nol dan status kredit; selain itu kosongkan.',
  harga_jual_1: 'Harga jual pertama; wajib lebih dari nol.',
  satuan_jual_1: 'Satuan untuk harga jual pertama.',
  konversi_jual_1: 'Jumlah satuan dasar per satuan jual; harus lebih dari nol.',
  harga_jual_2: 'Harga tier opsional. Jika diisi, satuan dan konversinya juga wajib diisi.',
  satuan_jual_2: 'Wajib jika harga jual 2 diisi.',
  konversi_jual_2: 'Wajib dan lebih dari nol jika harga jual 2 diisi.',
  harga_jual_3: 'Harga tier opsional. Jika diisi, satuan dan konversinya juga wajib diisi.',
  satuan_jual_3: 'Wajib jika harga jual 3 diisi.',
  konversi_jual_3: 'Wajib dan lebih dari nol jika harga jual 3 diisi.',
  harga_jual_4: 'Harga tier opsional. Jika diisi, satuan dan konversinya juga wajib diisi.',
  satuan_jual_4: 'Wajib jika harga jual 4 diisi.',
  konversi_jual_4: 'Wajib dan lebih dari nol jika harga jual 4 diisi.',
  harga_jual_5: 'Harga tier opsional. Jika diisi, satuan dan konversinya juga wajib diisi.',
  satuan_jual_5: 'Wajib jika harga jual 5 diisi.',
  konversi_jual_5: 'Wajib dan lebih dari nol jika harga jual 5 diisi.',
}

export interface ProductImportVendor {
  id: string
  name: string
}

export interface ProductImportReferences {
  vendors: ProductImportVendor[]
  units: string[]
  existingSkus: string[]
}

export interface ProductImportRow {
  excel_row: number
  name: string
  sku: string
  barcode: string | null
  stock_unit: string
  opening_stock: number
  min_stock: number
  cost_price: number
  cost_unit: string
  cost_conversion: number
  unit_base: 'pcs' | 'meter'
  vendor_id: string
  vendor_name: string
  payment_status: 'lunas' | 'kredit'
  due_date: string | null
  prices: ProductPrice[]
}

export interface ProductImportIssue {
  row: number | null
  field: string
  value: string
  message: string
}

export interface ProductImportValidation {
  rows: ProductImportRow[]
  issues: ProductImportIssue[]
  extraColumns: string[]
  nonEmptyRows: number
}

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''
}

function displayValue(value: unknown) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? 'Tanggal tidak valid' : value.toISOString().slice(0, 10)
  if (typeof value === 'object' && value !== null && 'text' in value && typeof value.text === 'string') return value.text
  if (value === null || value === undefined) return ''
  return String(value)
}

function cellValue(value: ExcelJS.CellValue): unknown {
  if (value && typeof value === 'object' && 'result' in value && value.result !== undefined) return value.result
  if (value && typeof value === 'object' && 'richText' in value) return value.richText.map((part) => part.text).join('')
  return value
}

function dateToISO(value: unknown): string | null {
  let date: Date
  if (value instanceof Date) {
    date = value
  } else if (typeof value === 'number' && Number.isFinite(value)) {
    date = new Date(Date.UTC(1899, 11, 30) + value * 24 * 60 * 60 * 1000)
  } else {
    return null
  }
  if (Number.isNaN(date.getTime())) return null
  const iso = date.toISOString().slice(0, 10)
  const [year, month, day] = iso.split('-').map(Number)
  const check = new Date(Date.UTC(year, month - 1, day))
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null
  return year >= 1900 && year <= 9999 ? iso : null
}

export function validateProductWorkbook(
  workbook: ExcelJS.Workbook,
  references: ProductImportReferences,
): ProductImportValidation {
  const issues: ProductImportIssue[] = []
  const rows: ProductImportRow[] = []
  const worksheet = workbook.getWorksheet('Produk')
  if (!worksheet) {
    return {
      rows,
      issues: [{ row: 1, field: 'Lembar kerja', value: 'Produk', message: 'Lembar Produk tidak ditemukan. Gunakan template impor master produk.' }],
      extraColumns: [],
      nonEmptyRows: 0,
    }
  }

  const headerRow = worksheet.getRow(1)
  const headerIndexes = new Map<string, number>()
  const extraColumns: string[] = []
  const duplicateHeaders = new Set<string>()
  headerRow.eachCell({ includeEmpty: false }, (cell, column) => {
    const rawHeader = cellValue(cell.value)
    const header = typeof rawHeader === 'string' ? rawHeader : normalizeText(rawHeader)
    if (header) {
      if ((PRODUCT_IMPORT_HEADERS as readonly string[]).includes(header)) {
        if (headerIndexes.has(header)) duplicateHeaders.add(header)
        headerIndexes.set(header, column)
      }
      else extraColumns.push(header)
    }
  })
  for (const header of duplicateHeaders) {
    issues.push({
      row: 1,
      field: 'Header',
      value: header,
      message: `Header "${header}" muncul lebih dari sekali. Setiap kolom harus memiliki header yang berbeda.`,
    })
  }
  for (const header of PRODUCT_IMPORT_HEADERS) {
    if (!headerIndexes.has(header)) {
      issues.push({
        row: 1,
        field: 'Header',
        value: header,
        message: `Header "${header}" tidak ditemukan atau sudah diubah. Pulihkan nama kolom persis seperti template.`,
      })
    }
  }
  if (issues.length > 0) return { rows, issues, extraColumns, nonEmptyRows: 0 }

  const unitMap = new Map(references.units.map((unit) => [unit.trim().toLocaleLowerCase(), unit]))
  const builtInUnits = new Set(Object.keys(UNIT_LABELS))
  const vendorMap = new Map(references.vendors.map((vendor) => [vendor.name.trim().toLocaleLowerCase(), vendor]))
  const existingSkus = new Set(references.existingSkus.map((sku) => sku.trim().toLocaleLowerCase()))
  const seenSkus = new Map<string, number>()
  let nonEmptyRows = 0

  worksheet.eachRow({ includeEmpty: false }, (worksheetRow, rowNumber) => {
    if (rowNumber === 1) return
    let rowHasContent = false
    worksheetRow.eachCell({ includeEmpty: false }, (cell) => {
      if (normalizeText(displayValue(cellValue(cell.value))) !== '') rowHasContent = true
    })
    if (!rowHasContent) return
    const values = PRODUCT_IMPORT_HEADERS.map((header) => {
      const column = headerIndexes.get(header)!
      return cellValue(worksheetRow.getCell(column).value)
    })
    nonEmptyRows += 1
    if (nonEmptyRows > PRODUCT_IMPORT_MAX_ROWS) return

    const valueAt = (header: typeof PRODUCT_IMPORT_HEADERS[number]) => values[PRODUCT_IMPORT_HEADERS.indexOf(header)]
    const rawAt = (header: typeof PRODUCT_IMPORT_HEADERS[number]) => displayValue(valueAt(header))
    const rowIssue = (field: string, value: unknown, message: string) => {
      issues.push({ row: rowNumber, field: FIELD_LABELS[field] || field, value: displayValue(value), message })
    }
    const textField = (header: typeof PRODUCT_IMPORT_HEADERS[number], required: boolean) => {
      const raw = valueAt(header)
      if (raw === null || raw === undefined || raw === '') {
        if (required) rowIssue(header, raw, `${FIELD_LABELS[header]} wajib diisi.`)
        return ''
      }
      if (typeof raw !== 'string' && !(raw && typeof raw === 'object' && 'text' in raw)) {
        rowIssue(header, raw, `${FIELD_LABELS[header]} harus berupa teks. Simpan SKU dan barcode sebagai teks di Excel.`)
        return ''
      }
      const text = normalizeText(raw && typeof raw === 'object' && 'text' in raw ? raw.text : raw)
      if (required && !text) rowIssue(header, raw, `${FIELD_LABELS[header]} wajib diisi.`)
      return text
    }
    const numericField = (
      header: typeof PRODUCT_IMPORT_HEADERS[number],
      required: boolean,
      minimum: number,
      strict = false,
    ) => {
      const raw = valueAt(header)
      if (raw === null || raw === undefined || raw === '') {
        if (required) rowIssue(header, raw, `${FIELD_LABELS[header]} wajib diisi dengan angka.`)
        return null
      }
      const number = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw.trim()) : Number.NaN
      if (!Number.isFinite(number)) {
        rowIssue(header, raw, `${FIELD_LABELS[header]} harus berupa angka yang valid.`)
        return null
      }
      if (strict ? number <= minimum : number < minimum) {
        rowIssue(header, raw, strict ? `${FIELD_LABELS[header]} harus lebih dari ${minimum}.` : `${FIELD_LABELS[header]} tidak boleh kurang dari ${minimum}.`)
        return null
      }
      return number
    }
    const unitField = (header: typeof PRODUCT_IMPORT_HEADERS[number], required: boolean) => {
      const text = textField(header, required)
      if (!text) return ''
      const normalized = text.toLocaleLowerCase()
      const canonical = builtInUnits.has(normalized) ? normalized : unitMap.get(normalized)
      if (!canonical) {
        rowIssue(header, text, `Satuan "${text}" belum tersimpan. Tambahkan di Pengaturan → Data dasar lalu unggah ulang.`)
        return ''
      }
      return canonical
    }

    const name = textField('nama_produk', true)
    const sku = textField('sku', true)
    const barcode = textField('barcode', false)
    const stockUnit = unitField('satuan_stok', true)
    const openingStock = numericField('stok_awal', true, 0)
    const minStock = numericField('stok_minimum', true, 0)
    const costPrice = numericField('harga_modal', true, 0, true)
    const costUnit = unitField('satuan_modal', true)
    const costConversion = numericField('konversi_modal', true, 0, true)
    const unitBase = textField('satuan_dasar', true).toLocaleLowerCase()
    if (unitBase && unitBase !== 'pcs' && unitBase !== 'meter') rowIssue('satuan_dasar', valueAt('satuan_dasar'), 'Satuan dasar harus pcs atau meter.')
    const vendorText = textField('vendor', true)
    const vendor = vendorMap.get(vendorText.toLocaleLowerCase())
    if (vendorText && !vendor) rowIssue('vendor', vendorText, `Vendor "${vendorText}" belum tersimpan. Tambahkan vendor di Pengaturan → Data dasar lalu unggah ulang.`)
    const paymentText = textField('status_bayar_awal', true).toLocaleLowerCase()
    if (paymentText && paymentText !== 'lunas' && paymentText !== 'kredit') rowIssue('status_bayar_awal', valueAt('status_bayar_awal'), 'Status pembayaran harus lunas atau kredit.')
    const paymentStatus = paymentText === 'kredit' ? 'kredit' : 'lunas'
    const dueDateValue = valueAt('jatuh_tempo')
    const dueDateText = normalizeText(rawAt('jatuh_tempo'))
    const dueDate = dueDateValue === null || dueDateValue === undefined || dueDateValue === '' ? null : dateToISO(dueDateValue)
    if (dueDateValue !== null && dueDateValue !== undefined && dueDateValue !== '' && !dueDate) {
      rowIssue('jatuh_tempo', dueDateValue, 'Jatuh tempo harus berupa tanggal Excel yang valid.')
    }
    if (openingStock !== null && openingStock > 0 && paymentStatus === 'kredit' && !dueDate) {
      rowIssue('jatuh_tempo', dueDateValue, 'Tanggal jatuh tempo wajib diisi untuk stok awal kredit.')
    } else if (!(openingStock !== null && openingStock > 0 && paymentStatus === 'kredit') && dueDateText) {
      rowIssue('jatuh_tempo', dueDateValue, 'Kosongkan jatuh tempo kecuali stok awal lebih dari nol dan statusnya kredit.')
    }

    const prices: ProductPrice[] = []
    const sellingUnits = new Set<string>()
    for (let tier = 1; tier <= 5; tier += 1) {
      const priceHeader = `harga_jual_${tier}` as typeof PRODUCT_IMPORT_HEADERS[number]
      const unitHeader = `satuan_jual_${tier}` as typeof PRODUCT_IMPORT_HEADERS[number]
      const conversionHeader = `konversi_jual_${tier}` as typeof PRODUCT_IMPORT_HEADERS[number]
      const tierRequired = tier === 1
      const rawPrice = valueAt(priceHeader)
      const rawUnit = valueAt(unitHeader)
      const rawConversion = valueAt(conversionHeader)
      const tierHasValues = [rawPrice, rawUnit, rawConversion].some((value) => normalizeText(displayValue(value)) !== '')
      if (!tierRequired && !tierHasValues) continue
      const price = numericField(priceHeader, tierRequired, 0, true)
      const unit = unitField(unitHeader, tierRequired || tierHasValues)
      const conversion = numericField(conversionHeader, tierRequired || tierHasValues, 0, true)
      if (unit) {
        const key = unit.toLocaleLowerCase()
        if (sellingUnits.has(key)) rowIssue(unitHeader, rawUnit, `Satuan jual "${unit}" dipakai lebih dari sekali. Gunakan satuan berbeda untuk setiap tier.`)
        sellingUnits.add(key)
      }
      if (price !== null && unit && conversion !== null) prices.push({ unit, price, conversion })
    }

    const skuKey = sku.toLocaleLowerCase()
    if (sku) {
      if (existingSkus.has(skuKey)) rowIssue('sku', sku, `SKU "${sku}" sudah digunakan produk yang ada. Impor hanya menambahkan produk baru.`)
      const firstRow = seenSkus.get(skuKey)
      if (firstRow !== undefined) {
        rowIssue('sku', sku, `SKU "${sku}" juga muncul pada baris Excel ${firstRow}. Gunakan SKU unik pada setiap baris.`)
      } else {
        seenSkus.set(skuKey, rowNumber)
      }
    }

    const rowHasIssues = issues.some((issue) => issue.row === rowNumber)
    if (!rowHasIssues && openingStock !== null && minStock !== null && costPrice !== null && costConversion !== null && vendor && unitBase && (unitBase === 'pcs' || unitBase === 'meter')) {
      rows.push({
        excel_row: rowNumber,
        name,
        sku,
        barcode: barcode || null,
        stock_unit: stockUnit,
        opening_stock: openingStock,
        min_stock: minStock,
        cost_price: costPrice,
        cost_unit: costUnit,
        cost_conversion: costConversion,
        unit_base: unitBase,
        vendor_id: vendor.id,
        vendor_name: vendor.name,
        payment_status: paymentStatus,
        due_date: dueDate,
        prices,
      })
    }
  })

  if (nonEmptyRows === 0) {
    issues.push({ row: null, field: 'Data', value: '', message: 'Tidak ada baris produk yang terisi pada lembar Produk.' })
  } else if (nonEmptyRows > PRODUCT_IMPORT_MAX_ROWS) {
    issues.push({
      row: null,
      field: 'Jumlah baris',
      value: String(nonEmptyRows),
      message: `File berisi ${nonEmptyRows} baris produk; batas impor adalah ${PRODUCT_IMPORT_MAX_ROWS}.`,
    })
  }

  return { rows, issues, extraColumns, nonEmptyRows }
}

export async function parseProductWorkbook(buffer: ArrayBuffer, references: ProductImportReferences) {
  const { default: ExcelJS } = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)
  return validateProductWorkbook(workbook, references)
}

export async function createProductImportTemplate() {
  const { default: ExcelJS } = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'RAJA Aksesoris POS'
  workbook.created = new Date()
  const products = workbook.addWorksheet('Produk', {
    views: [{ state: 'frozen', ySplit: 1 }],
  })
  products.columns = PRODUCT_IMPORT_HEADERS.map((header) => ({
    header,
    key: header,
    width: Math.max(16, Math.min(24, header.length + 4)),
  }))
  products.autoFilter = { from: 'A1', to: `${products.getColumn(PRODUCT_IMPORT_HEADERS.length).letter}1` }
  products.getColumn('B').numFmt = '@'
  products.getColumn('C').numFmt = '@'
  products.getRow(1).height = 32
  products.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF216C68' } }
    cell.alignment = { vertical: 'middle', wrapText: true }
    cell.note = FIELD_DESCRIPTIONS[String(cell.value)] || ''
  })
  for (let row = 2; row <= PRODUCT_IMPORT_MAX_ROWS + 1; row += 1) {
    products.getCell(`M${row}`).numFmt = 'dd/mm/yyyy'
  }
  const addDataValidation = (
    range: string,
    rule: {
      type: string
      operator?: string
      formulae: (string | number | Date)[]
      allowBlank?: boolean
      showErrorMessage?: boolean
      errorTitle?: string
      error?: string
    },
  ) => {
    const sheet = products as unknown as {
      dataValidations: { add: (cellRange: string, validation: typeof rule) => void }
    }
    sheet.dataValidations.add(range, rule)
  }
  for (const col of ['E', 'F', 'N', 'Q', 'T', 'W', 'Z']) {
    addDataValidation(`${col}2:${col}${PRODUCT_IMPORT_MAX_ROWS + 1}`, {
      type: 'decimal',
      operator: 'greaterThanOrEqual',
      formulae: [0],
      allowBlank: col === 'Q' || col === 'T' || col === 'W' || col === 'Z',
      showErrorMessage: true,
      errorTitle: 'Angka tidak valid',
      error: 'Masukkan angka sesuai panduan pada lembar Panduan.',
    })
  }
  for (const col of ['G', 'I', 'P', 'S', 'V', 'Y', 'AB']) {
    addDataValidation(`${col}2:${col}${PRODUCT_IMPORT_MAX_ROWS + 1}`, {
      type: 'decimal',
      operator: 'greaterThan',
      formulae: [0],
      allowBlank: col !== 'I' && col !== 'P',
      showErrorMessage: true,
      errorTitle: 'Konversi tidak valid',
      error: 'Konversi harus lebih dari nol.',
    })
  }
  addDataValidation(`J2:J${PRODUCT_IMPORT_MAX_ROWS + 1}`, {
    type: 'list',
    formulae: ['"pcs,meter"'],
    allowBlank: false,
    showErrorMessage: true,
    error: 'Pilih pcs atau meter.',
  })
  addDataValidation(`L2:L${PRODUCT_IMPORT_MAX_ROWS + 1}`, {
    type: 'list',
    formulae: ['"lunas,kredit"'],
    allowBlank: false,
    showErrorMessage: true,
    error: 'Pilih lunas atau kredit.',
  })
  addDataValidation(`M2:M${PRODUCT_IMPORT_MAX_ROWS + 1}`, {
    type: 'date',
    operator: 'between',
    formulae: [new Date(Date.UTC(1900, 0, 1)), new Date(Date.UTC(9999, 11, 31))],
    allowBlank: true,
    showErrorMessage: true,
    error: 'Masukkan tanggal Excel yang valid.',
  })

  const guide = workbook.addWorksheet('Panduan')
  guide.columns = [
    { header: 'Kolom', key: 'field', width: 26 },
    { header: 'Wajib?', key: 'required', width: 15 },
    { header: 'Panduan dan nilai yang diterima', key: 'description', width: 86 },
  ]
  guide.addRows(PRODUCT_IMPORT_HEADERS.map((field) => ({
    field,
    required: REQUIRED_FIELDS.includes(field) ? 'Ya' : field === 'jatuh_tempo' ? 'Kondisional' : 'Opsional / tier',
    description: FIELD_DESCRIPTIONS[field],
  })))
  guide.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
  guide.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF216C68' } }
  guide.getColumn(3).alignment = { wrapText: true, vertical: 'top' }
  guide.views = [{ state: 'frozen', ySplit: 1 }]
  const exampleTitle = PRODUCT_IMPORT_HEADERS.length + 4
  guide.getCell(`A${exampleTitle}`).value = 'Contoh satu baris (panduan saja — jangan salin ke lembar Produk)'
  guide.getCell(`A${exampleTitle}`).font = { bold: true, color: { argb: 'FF155E75' } }
  const exampleHeader = guide.getRow(exampleTitle + 1)
  const exampleValues = [
    'Contoh Produk', 'CONTOH-001', '00001234', 'satuan', 10, 2, 1000, 'satuan', 1, 'pcs',
    'Vendor Contoh', 'lunas', null, 1500, 'satuan', 1,
    null, null, null, null, null, null, null, null, null, null, null, null,
  ]
  PRODUCT_IMPORT_HEADERS.forEach((header, index) => {
    const cell = exampleHeader.getCell(index + 1)
    cell.value = header
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF667174' } }
    const valueCell = guide.getRow(exampleTitle + 2).getCell(index + 1)
    valueCell.value = exampleValues[index]
    if (header === 'sku' || header === 'barcode') valueCell.numFmt = '@'
  })
  guide.getRow(exampleTitle + 2).eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F0E9' } }
  })
  guide.getCell(`A${exampleTitle + 4}`).value = 'Catatan'
  guide.getCell(`A${exampleTitle + 4}`).font = { bold: true }
  guide.getCell(`B${exampleTitle + 4}`).value = 'Produk hanya dibaca dari lembar Produk. Isi vendor/satuan khusus dari data yang sudah tersimpan. SKU yang berulang atau sudah ada akan menolak seluruh impor.'
  guide.mergeCells(`B${exampleTitle + 4}:C${exampleTitle + 4}`)
  guide.getCell(`B${exampleTitle + 4}`).alignment = { wrapText: true }

  return workbook.xlsx.writeBuffer()
}

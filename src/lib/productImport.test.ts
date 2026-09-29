import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import {
  createProductImportTemplate,
  parseProductWorkbook,
  PRODUCT_IMPORT_HEADERS,
  type ProductImportReferences,
} from '@/lib/productImport'

const references: ProductImportReferences = {
  vendors: [{ id: 'vendor-1', name: 'Vendor Utama' }],
  units: ['satuan', 'lusin', 'kodi', 'gross', 'meter', 'pack', 'Kotak Custom'],
  existingSkus: ['OLD-001'],
}

function validRow(overrides: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    nama_produk: 'Produk Contoh',
    sku: 'NEW-001',
    barcode: '00001234',
    satuan_stok: 'SATUAN',
    stok_awal: 5,
    stok_minimum: 1,
    harga_modal: 1000,
    satuan_modal: 'satuan',
    konversi_modal: 1,
    satuan_dasar: 'pcs',
    vendor: ' vendor utama ',
    status_bayar_awal: 'lunas',
    jatuh_tempo: null,
    harga_jual_1: 1500,
    satuan_jual_1: 'satuan',
    konversi_jual_1: 1,
    harga_jual_2: null,
    satuan_jual_2: null,
    konversi_jual_2: null,
    harga_jual_3: null,
    satuan_jual_3: null,
    konversi_jual_3: null,
    harga_jual_4: null,
    satuan_jual_4: null,
    konversi_jual_4: null,
    harga_jual_5: null,
    satuan_jual_5: null,
    konversi_jual_5: null,
    ...overrides,
  }
  return PRODUCT_IMPORT_HEADERS.map((header) => values[header])
}

async function workbookBuffer(headers: string[] = [...PRODUCT_IMPORT_HEADERS], rows: unknown[][] = [validRow()]) {
  const workbook = new ExcelJS.Workbook()
  const worksheet = workbook.addWorksheet('Produk')
  worksheet.addRow(headers)
  rows.forEach((row) => worksheet.addRow(row))
  return workbook.xlsx.writeBuffer() as Promise<ArrayBuffer>
}

async function parse(rows: unknown[][] = [validRow()], headers: string[] = [...PRODUCT_IMPORT_HEADERS]) {
  return parseProductWorkbook(await workbookBuffer(headers, rows), references)
}

describe('product import workbook validation', () => {
  it('accepts a valid row and normalizes vendor and unit names while preserving text identifiers', async () => {
    const result = await parse()
    expect(result.issues).toEqual([])
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).toMatchObject({
      excel_row: 2,
      sku: 'NEW-001',
      barcode: '00001234',
      stock_unit: 'satuan',
      vendor_id: 'vendor-1',
      vendor_name: 'Vendor Utama',
      prices: [{ unit: 'satuan', price: 1500, conversion: 1 }],
    })
  })

  it('accepts Excel date values for positive opening stock paid on credit', async () => {
    const result = await parse([validRow({
      status_bayar_awal: 'kredit',
      jatuh_tempo: new Date(Date.UTC(2026, 11, 31)),
    })])
    expect(result.issues).toEqual([])
    expect(result.rows[0]).toMatchObject({
      opening_stock: 5,
      payment_status: 'kredit',
      due_date: '2026-12-31',
      vendor_id: 'vendor-1',
    })
  })

  it('allows zero opening stock without creating a due date requirement', async () => {
    const result = await parse([validRow({ stok_awal: 0, status_bayar_awal: 'kredit' })])
    expect(result.issues).toEqual([])
    expect(result.rows[0].opening_stock).toBe(0)
    expect(result.rows[0].due_date).toBeNull()
  })

  it('reports missing and renamed headers without guessing column positions', async () => {
    const headers: string[] = [...PRODUCT_IMPORT_HEADERS]
    headers[1] = 'kode_produk'
    const result = await parse([validRow()], headers)
    expect(result.rows).toEqual([])
    expect(result.issues.some((issue) => issue.field === 'Header' && issue.value === 'sku')).toBe(true)
  })

  it('rejects a workbook that does not contain the Produk sheet', async () => {
    const workbook = new ExcelJS.Workbook()
    workbook.addWorksheet('Panduan')
    const result = await parseProductWorkbook(await workbook.xlsx.writeBuffer() as ArrayBuffer, references)
    expect(result.issues[0].message).toContain('Lembar Produk tidak ditemukan')
  })

  it('rejects malformed workbook bytes', async () => {
    await expect(parseProductWorkbook(new TextEncoder().encode('not an xlsx').buffer, references)).rejects.toThrow()
  })

  it('ignores empty rows and preserves the actual Excel row number', async () => {
    const result = await parse([[], validRow()])
    expect(result.nonEmptyRows).toBe(1)
    expect(result.rows[0].excel_row).toBe(3)
  })

  it('rejects an empty Produk sheet and repeated or existing SKUs', async () => {
    const empty = await parse([[]])
    expect(empty.issues.some((issue) => issue.message.includes('Tidak ada baris produk'))).toBe(true)

    const repeated = await parse([validRow(), validRow({ sku: 'new-001' })])
    expect(repeated.issues.filter((issue) => issue.field === 'SKU')).toHaveLength(1)
    expect(repeated.issues[0].message).toContain('baris Excel 2')

    const existing = await parse([validRow({ sku: 'old-001' })])
    expect(existing.issues.some((issue) => issue.field === 'SKU' && issue.message.includes('sudah digunakan'))).toBe(true)
  })

  it('rejects more than 500 non-empty product rows', async () => {
    const rows = Array.from({ length: 501 }, (_, index) => validRow({ sku: `SKU-${index + 1}` }))
    const result = await parse(rows)
    expect(result.nonEmptyRows).toBe(501)
    expect(result.issues.some((issue) => issue.field === 'Jumlah baris')).toBe(true)
  })

  it('rejects invalid units, vendors, dates, prices, and repeated selling units', async () => {
    const result = await parse([validRow({
      satuan_stok: 'unit-hilang',
      vendor: 'Vendor Baru',
      stok_awal: 2,
      status_bayar_awal: 'kredit',
      jatuh_tempo: '31/12/2026',
      harga_jual_1: 0,
      harga_jual_2: 1800,
      satuan_jual_2: 'SATUAN',
      konversi_jual_2: 2,
    })])
    const fields = result.issues.map((issue) => issue.field)
    expect(fields).toContain('Satuan stok')
    expect(fields).toContain('Vendor')
    expect(fields).toContain('Jatuh tempo')
    expect(fields).toContain('Harga jual 1')
    expect(fields).toContain('Satuan jual 2')
  })

  it('rejects rows containing numeric SKUs so leading zeroes are not lost', async () => {
    const result = await parse([validRow({ sku: 123 })])
    expect(result.issues.some((issue) => issue.field === 'SKU' && issue.message.includes('harus berupa teks'))).toBe(true)
  })

  it('requires a positive cost price to match the product form', async () => {
    const result = await parse([validRow({ harga_modal: 0 })])
    expect(result.issues.some((issue) => issue.field === 'Harga modal')).toBe(true)
  })

  it('creates a real workbook with a header-only Produk sheet and a separate example guide', async () => {
    const bytes = await createProductImportTemplate()
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(bytes as ArrayBuffer)
    const products = workbook.getWorksheet('Produk')
    const guide = workbook.getWorksheet('Panduan')
    expect(products).toBeDefined()
    expect(guide).toBeDefined()
    expect(products?.rowCount).toBe(501)
    expect(products?.getRow(1).values).toContain('nama_produk')
    expect(products?.getColumn('B').numFmt).toBe('@')
    expect(products?.getColumn('C').numFmt).toBe('@')
    for (let row = 2; row <= 501; row += 1) {
      for (let column = 1; column <= PRODUCT_IMPORT_HEADERS.length; column += 1) {
        expect(products?.getCell(row, column).value).toBeNull()
      }
    }
    expect(products?.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 })
    expect(products?.autoFilter).toBeDefined()
    expect(guide?.getCell('A32').value).toContain('Contoh satu baris')
  })
})

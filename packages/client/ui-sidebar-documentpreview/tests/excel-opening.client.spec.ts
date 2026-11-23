/** URI and part-name aliases and orphan drawings preserve usable workbook previews. */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import ExcelJS from 'exceljs'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { Config } from '../src/config.ts'
import { convertExcel } from '../src/client/excel/convert.ts'
import { XlsxPreviewArchive } from '../src/client/excel/xlsx-archive.ts'
import { excelOpeningCases, excelOpeningFixture } from './excel-opening-fixture.ts'
import { excelOpcFixture } from './excel-opc-fixture.ts'

const require = createRequire(import.meta.url)
const browserExcel = require('exceljs/dist/exceljs.js') as typeof ExcelJS
const limits = Config({}).excel

describe.each([['Node', ExcelJS], ['browser bundle', browserExcel]] as const)('%s opening regressions', (_name, parser) => {
  it.each(excelOpeningCases)('opens %s with cells, styles, comments, Tables and hyperlinks', async (name) => {
    const source = await excelOpeningFixture(name)
    const original = source.slice()
    const retained = new XlsxPreviewArchive(source).withoutDrawings()
    const workbook = new parser.Workbook()
    await workbook.xlsx.load(retained.buffer, { ignoreNodes: ['drawing'] })
    const sheet = workbook.getWorksheet('数据')
    assert.ok(sheet)
    expect(sheet.getCell('A1').value).toBe('Item')
    expect(sheet.getCell('B2').value).toBe(42)
    expect(sheet.getCell('B2').font).toMatchObject({ bold: true, color: { argb: 'FF112233' } })
    expect(sheet.getCell('B2').note).toBe('生成的批注')
    expect(sheet.getTable('DataTable')).toMatchObject({ table: { tableRef: 'A1:B3' } })
    expect(sheet.getCell('A2').hyperlink).toBe('https://example.com/?a=1&b=2')
    expect(workbook.getWorksheet('隐藏页')?.state).toBe('hidden')
    const originalParts = unzipSync(source)
    for (const [path, bytes] of Object.entries(unzipSync(retained))) expect(bytes, path).toEqual(originalParts[path])
    expect(source).toEqual(original)
  })

  it.each(['xl/workbook.xml', '_rels/.rels'])('rejects ambiguous ASCII case-equivalent entries for %s', async (path) => {
    const files = unzipSync(await excelOpcFixture('combined'))
    const bytes = files[path]
    assert.ok(bytes)
    files[path.toUpperCase()] = bytes
    const source = new Uint8Array(zipSync(files))
    await expect(new parser.Workbook().xlsx.load(source.buffer)).rejects.toThrow(/Ambiguous.*part/i)
  })
})

it.each(excelOpeningCases)('preserves the complete preview and referenced-content notices for %s', async (name) => {
  const expected = await convertExcel(await excelOpcFixture('combined'), 'xlsx', limits)
  if (name === 'orphan-drawing') expected.unsupportedFeatures = ['conditionalFormatting']
  expect(await convertExcel(await excelOpeningFixture(name), 'xlsx', limits)).toEqual(expected)
})

it('omits orphan DrawingML and its relationships while retaining comment VML', async () => {
  const source = await excelOpeningFixture('orphan-drawing')
  const original = unzipSync(source)
  expect(original['xl/drawings/drawing1.xml']).toBeDefined()
  expect(original['xl/drawings/_rels/drawing1.xml.rels']).toBeDefined()
  const archive = new XlsxPreviewArchive(source)
  const retained = unzipSync(archive.withoutDrawings())
  expect(retained['xl/drawings/drawing1.xml']).toBeUndefined()
  expect(retained['xl/drawings/_rels/drawing1.xml.rels']).toBeUndefined()
  expect(retained['xl/drawings/commentsDrawing1.vml']).toEqual(original['xl/drawings/commentsDrawing1.vml'])
  expect([...archive.unsupportedFeatures]).toEqual(['conditionalFormatting'])
})

it('rejects ambiguous part names before filtering can hide either entry', async () => {
  const files = unzipSync(await excelOpcFixture('combined'))
  const drawing = files['xl/drawings/drawing1.xml']
  assert.ok(drawing)
  files['XL/DRAWINGS/DRAWING1.XML'] = drawing
  await expect(convertExcel(new Uint8Array(zipSync(files)), 'xlsx', limits)).rejects.toMatchObject({ code: 'invalid' })
})

it('does not fold non-ASCII characters when resolving part names', async () => {
  const files = unzipSync(await excelOpcFixture('combined'))
  const path = 'xl/_rels/workbook.xml.rels'
  const rels = files[path]
  const sheet = files['xl/worksheets/budget.xml']
  assert.ok(rels)
  assert.ok(sheet)
  files[path] = strToU8(strFromU8(rels).replace('worksheets/budget.xml', 'worksheets/Ä.xml'))
  files['xl/worksheets/ä.xml'] = sheet
  await expect(convertExcel(new Uint8Array(zipSync(files)), 'xlsx', limits)).rejects.toMatchObject({ code: 'invalid' })
})

function storedZip(entries: readonly (readonly [string, string])[]): Uint8Array<ArrayBuffer> {
  const local: number[][] = []
  const central: number[][] = []
  let offset = 0
  const u16 = (value: number): number[] => [value & 0xff, value >>> 8]
  const u32 = (value: number): number[] => [...u16(value & 0xffff), ...u16(value >>> 16)]
  for (const [name, text] of entries) {
    const nameBytes = [...strToU8(name)]
    const data = [...strToU8(text)]
    const shared = [...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0x21), ...u32(0), ...u32(data.length), ...u32(data.length), ...u16(nameBytes.length), ...u16(0)]
    local.push([...u32(0x04034b50), ...shared, ...nameBytes, ...data])
    central.push([...u32(0x02014b50), ...u16(20), ...shared, ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...nameBytes])
    offset += local.at(-1)!.length
  }
  const directory = central.flat()
  const end = [...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(entries.length), ...u16(entries.length), ...u32(directory.length), ...u32(offset), ...u16(0)]
  return new Uint8Array([...local.flat(), ...directory, ...end])
}

it.each(['xl/workbook.xml', 'xl/drawings/drawing1.xml'])('rejects byte-identical duplicate ZIP names for %s', (name) => {
  const archive = storedZip([[name, '<first/>'], ['other.xml', '<x/>'], [name, '<second/>']])
  expect(Object.keys(unzipSync(archive))).toHaveLength(2)
  expect(() => new XlsxPreviewArchive(archive)).toThrow(/Ambiguous XLSX part/)
})

it('rejects archives by declared size and entry count before decompressing', () => {
  const bomb = new Uint8Array(zipSync({ 'xl/big.xml': new Uint8Array(1 << 20) }, { level: 9 }))
  expect(bomb.byteLength).toBeLessThan(4096)
  expect(() => new XlsxPreviewArchive(bomb, { maxExpandedBytes: 1024 })).toThrow(expect.objectContaining({ code: 'tooLarge' }))
  expect(() => new XlsxPreviewArchive(bomb, { maxEntryBytes: 1024 })).toThrow(expect.objectContaining({ code: 'tooLarge' }))
  const many = storedZip([['a.xml', ''], ['b.xml', ''], ['c.xml', '']])
  expect(() => new XlsxPreviewArchive(many, { maxEntries: 2 })).toThrow(expect.objectContaining({ code: 'tooLarge' }))
  expect(() => new XlsxPreviewArchive(many, { maxEntries: 3 })).not.toThrow()
})

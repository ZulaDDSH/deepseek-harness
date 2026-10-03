import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { OfficeToPdfRequest } from '@deepseek-ai/dsh-office-to-pdf'
import { pdfFixture, selectionPdfFixture } from '../../ui-sidebar-documentpreview/tests/pdf-fixture.ts'
import { documentText } from '../src/document-text.ts'

it('extracts every PDF page with the installed library without consuming original bytes', async () => {
  const bytes = pdfFixture()
  const original = bytes.slice()
  const text = await documentText(new Context(), 'guide.pdf', bytes, 'fixture', 2000, new AbortController().signal)
  expect(text.match(/Selectable PDF text/g)).toHaveLength(2)
  expect(bytes).toEqual(original)
  await expect(documentText(new Context(), 'guide.pdf', bytes, 'fixture', 2, new AbortController().signal)).rejects.toThrow('character limit')
})

it('joins fragments on one line with spaces and ends each line with a newline', async () => {
  const text = await documentText(new Context(), 'journal.pdf', selectionPdfFixture(), 'h', 5000, new AbortController().signal)
  expect(text).toMatch(/NUMBER {2,}PRIORITY {2,}DONE/)
  expect(text).toMatch(/JOURNAL\nTODAY/)
})

describe('Office document extraction', () => {
  const withConverter = (convert: (request: OfficeToPdfRequest) => Promise<unknown>): Context => {
    const ctx = new Context()
    ctx.provide('officeToPdf', { convert } as never)
    return ctx
  }

  it('converts a copy of the original bytes and extracts the resulting PDF', async () => {
    const bytes = new Uint8Array([1, 2, 3])
    const seen: unknown[] = []
    const ctx = withConverter(async (request) => {
      seen.push(request.extension, request.source.key, request.source.version, request.source.bytes)
      const read = await request.source.read(new AbortController().signal, 10)
      expect(read.bytes).toEqual(bytes)
      expect(read.bytes).not.toBe(bytes)
      return { pdf: pdfFixture() }
    })
    expect(await documentText(ctx, 'Report.DOCX', bytes, 'abc', 2000, new AbortController().signal)).toContain('Selectable PDF text')
    expect(seen).toEqual(['docx', 'memorix-upload:abc', 'abc', 3])
  })

  it('rejects a conversion read that exceeds its limit or follows cancellation', async () => {
    const signal = new AbortController().signal
    const oversized = withConverter(request => request.source.read(signal, 1))
    await expect(documentText(oversized, 'a.xlsx', new Uint8Array(2), 'h', 2000, signal)).rejects.toThrow('conversion byte limit')
    const cancelled = withConverter(request => request.source.read(AbortSignal.abort(), 10))
    await expect(documentText(cancelled, 'a.pptx', new Uint8Array(2), 'h', 2000, signal)).rejects.toThrow()
  })

  it('destroys the PDF load when the import is cancelled mid-extraction', async () => {
    const controller = new AbortController()
    const add = controller.signal.addEventListener.bind(controller.signal)
    vi.spyOn(controller.signal, 'addEventListener').mockImplementation((type, listener, options) => {
      add(type, listener, options)
      controller.abort()
    })
    await expect(documentText(new Context(), 'guide.pdf', pdfFixture(), 'h', 2000, controller.signal)).rejects.toThrow()
  })
})

describe('document extraction rejection', () => {
  it('rejects corrupt PDFs, invalid UTF-8, unsupported formats and unavailable Office conversion', async () => {
    const signal = new AbortController().signal
    for (const filename of ['guide.pdf', 'guide.exe', 'guide.docx']) {
      await expect(documentText(new Context(), filename, new Uint8Array([255]), 'fixture', 2000, signal)).rejects.toThrow()
    }
    await expect(documentText(new Context(), 'guide.txt', new Uint8Array([255]), 'fixture', 2000, signal)).rejects.toThrow()
    await expect(documentText(new Context(), 'guide.txt', new Uint8Array([65]), 'fixture', 2000, AbortSignal.abort())).rejects.toThrow()
  })
})

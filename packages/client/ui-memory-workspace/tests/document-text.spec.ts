import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { pdfFixture } from '../../ui-sidebar-documentpreview/tests/pdf-fixture.ts'
import { documentText } from '../src/document-text.ts'

it('extracts every PDF page with the installed library without consuming original bytes', async () => {
  const bytes = pdfFixture()
  const original = bytes.slice()
  const text = await documentText(new Context(), 'guide.pdf', bytes, 'fixture', 2000, new AbortController().signal)
  expect(text.match(/Selectable PDF text/g)).toHaveLength(2)
  expect(bytes).toEqual(original)
  await expect(documentText(new Context(), 'guide.pdf', bytes, 'fixture', 2, new AbortController().signal)).rejects.toThrow('character limit')
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

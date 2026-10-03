/** Host extraction for uploaded UTF-8, PDF and Office documents. */
import { extname } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { OfficeSourceKey } from '@deepseek-ai/dsh-office-to-pdf'
import type { OfficeExtension } from '@deepseek-ai/dsh-office-to-pdf'

/**
 * Extract complete document text within configured limits.
 * @param ctx - Host with the existing Office conversion provider when required.
 * @param filename - uploaded filename identifying its format.
 * @param bytes - owned complete original bytes.
 * @param hash - original content identifier.
 * @param maxCharacters - maximum extracted text length; overflow rejects without truncation.
 * @param signal - import lifetime.
 * @returns extracted text; scans without text require OCR and reject.
 */
export async function documentText(ctx: Context, filename: string, bytes: Uint8Array, hash: string,
  maxCharacters: number, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted()
  const extension = extname(filename).slice(1).toLowerCase()
  let pdf: Uint8Array | undefined
  if (extension === 'pdf') pdf = bytes
  else if (['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'].includes(extension)) {
    const converter = ctx.get('officeToPdf')
    if (converter === undefined) throw new Error('Office document conversion is unavailable in this profile')
    pdf = (await converter.convert({ extension: extension as OfficeExtension, priority: 'foreground',
      source: { key: OfficeSourceKey(`memorix-upload:${hash}`), version: hash, bytes: bytes.byteLength,
        read: (reading, limit) => {
          reading.throwIfAborted()
          if (bytes.byteLength > limit) throw new Error('Document exceeds the conversion byte limit')
          return Promise.resolve({ bytes: bytes.slice(), version: hash })
        } },
    }, signal)).pdf
  } else {
    if (!['txt', 'md', 'csv', 'json', 'log'].includes(extension)) throw new Error('Unsupported document format')
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  }
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const loading = getDocument({ data: Uint8Array.from(pdf), useSystemFonts: false, stopAtErrors: true })
  const aborted = (): void => { void loading.destroy() }
  signal.addEventListener('abort', aborted, { once: true })
  try {
    const document = await loading.promise
    const pages: string[] = []
    let length = 0
    for (let index = 1; index <= document.numPages; index++) {
      signal.throwIfAborted()
      const page = await document.getPage(index)
      try {
        const content = await page.getTextContent()
        const text = content.items
          .filter((item): item is Extract<typeof item, { str: string }> => 'str' in item)
          .map(item => item.str + (item.hasEOL ? '\n' : ' '))
          .join('')
        length += text.length + 1
        if (length > maxCharacters) throw new Error('Extracted document exceeds the configured character limit')
        pages.push(text)
      } finally { page.cleanup() }
    }
    return pages.join('\n')
  } finally {
    signal.removeEventListener('abort', aborted)
    await loading.destroy()
  }
}

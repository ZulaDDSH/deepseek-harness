import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const NOTES_PATH = 'docs/code-notes/deepseek-harness.md'

export function loadAnchoredFieldNotes(
  scanRoot: string,
  notesPaths: string | readonly string[] = NOTES_PATH,
): Map<string, Map<string, string>> {
  const notes = new Map<string, Map<string, string>>()
  for (const notesPath of typeof notesPaths === 'string' ? [notesPaths] : notesPaths) {
    const path = resolve(scanRoot, notesPath)
    if (!existsSync(path)) continue
    for (const [anchor, fields] of parseAnchoredFieldNotes(readFileSync(path, 'utf8'))) {
      if (notes.has(anchor)) throw new Error(`duplicate code-note anchor '${anchor}' across files`)
      notes.set(anchor, fields)
    }
  }
  return notes
}

export function parseAnchoredFieldNotes(markdown: string): Map<string, Map<string, string>> {
  const notes = new Map<string, Map<string, string>>()
  let anchor: string | undefined
  for (const line of markdown.split(/\r?\n/)) {
    const heading = line.match(/^### `([^`]+)`\s*$/)
    if (heading) {
      anchor = heading[1]
      if (notes.has(anchor)) throw new Error(`duplicate code-note anchor '${anchor}'`)
      notes.set(anchor, new Map())
      continue
    }
    if (anchor && line.trim() === '') continue
    const field = anchor && line.match(/^- `([^`]+)`:\s*(\S.*)$/)
    if (field && anchor) {
      const fields = notes.get(anchor)!
      if (fields.has(field[1])) throw new Error(`duplicate code-note field '${anchor}.${field[1]}'`)
      fields.set(field[1], field[2].trim())
      continue
    }
    anchor = undefined
  }
  return notes
}

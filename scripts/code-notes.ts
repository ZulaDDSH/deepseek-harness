import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const REPO_ROOT = resolve(import.meta.dirname, '..')
const NOTES_FILE = 'deepseek-harness.md'

export function codeNotesDir(scanRoot: string = REPO_ROOT): string {
  if (resolve(scanRoot) !== REPO_ROOT) return resolve(scanRoot, 'docs/code-notes')
  if (process.env.DSH_CODE_NOTES_DIR) return resolve(process.env.DSH_CODE_NOTES_DIR)
  const sibling = resolve(REPO_ROOT, '..', 'CodeNotes', 'Deepseek Harness')
  return existsSync(sibling) ? sibling : resolve(REPO_ROOT, 'docs/code-notes')
}

export function missingCodeNotesMessage(scanRoot: string = REPO_ROOT): string | undefined {
  const dir = codeNotesDir(scanRoot)
  if (existsSync(dir)) return undefined
  return `code notes directory not found: ${dir}. Set DSH_CODE_NOTES_DIR to the "Deepseek Harness" folder of a ZulaDDSH/CodeNotes checkout.`
}

export function exitIfCodeNotesMissing(gate: string): void {
  const message = missingCodeNotesMessage()
  if (message === undefined) return
  console.error(`${gate}: ${message}`)
  process.exit(1)
}

export function loadAnchoredFieldNotes(
  scanRoot: string,
  notesPaths: string | readonly string[] = NOTES_FILE,
): Map<string, Map<string, string>> {
  const dir = codeNotesDir(scanRoot)
  const notes = new Map<string, Map<string, string>>()
  for (const notesPath of typeof notesPaths === 'string' ? [notesPaths] : notesPaths) {
    const path = resolve(dir, notesPath)
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
      anchor = heading[1]!
      if (notes.has(anchor)) throw new Error(`duplicate code-note anchor '${anchor}'`)
      notes.set(anchor, new Map())
      continue
    }
    if (anchor && line.trim() === '') continue
    const field = anchor && line.match(/^- `([^`]+)`:\s*(\S.*)$/)
    if (field && anchor) {
      const fields = notes.get(anchor)!
      if (fields.has(field[1]!)) throw new Error(`duplicate code-note field '${anchor}.${field[1]}'`)
      fields.set(field[1]!, field[2]!.trim())
      continue
    }
    anchor = undefined
  }
  return notes
}

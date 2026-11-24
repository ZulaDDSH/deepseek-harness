import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { codeNotesDir, missingCodeNotesMessage, parseAnchoredFieldNotes } from './code-notes.ts'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('anchored code-note fields', () => {
  it('reads field prose under source declaration headings', () => {
    expect(parseAnchoredFieldNotes(`
### \`packages/example/src/index.ts:Config\`
- \`enabled\`: Whether the feature is active.
- \`nested.value\`: The nested value.

Other prose ends the field list.
`)).toEqual(new Map([['packages/example/src/index.ts:Config', new Map([
      ['enabled', 'Whether the feature is active.'],
      ['nested.value', 'The nested value.'],
    ])]]))
  })

  it('rejects duplicate anchors and fields', () => {
    expect(() => parseAnchoredFieldNotes(`### \`a.ts:Config\`
### \`a.ts:Config\``)).toThrow('duplicate code-note anchor')
    expect(() => parseAnchoredFieldNotes(`### \`a.ts:Config\`
- \`enabled\`: One.
- \`enabled\`: Two.`)).toThrow('duplicate code-note field')
  })
})

describe('code notes directory', () => {
  it('uses DSH_CODE_NOTES_DIR for the repository root and names it when the directory is absent', () => {
    vi.stubEnv('DSH_CODE_NOTES_DIR', tmpdir())
    expect(codeNotesDir()).toBe(resolve(tmpdir()))
    expect(missingCodeNotesMessage()).toBeUndefined()
    vi.stubEnv('DSH_CODE_NOTES_DIR', join(tmpdir(), 'dsh-missing-code-notes'))
    expect(missingCodeNotesMessage()).toContain('DSH_CODE_NOTES_DIR')
  })

  it('keeps other scan roots on their own docs/code-notes directory', () => {
    vi.stubEnv('DSH_CODE_NOTES_DIR', tmpdir())
    expect(codeNotesDir(join(tmpdir(), 'fixture-root'))).toBe(resolve(tmpdir(), 'fixture-root', 'docs/code-notes'))
  })
})

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { collectExportJsdocViolations } from './verify-export-jsdoc.ts'

const roots: string[] = []

function fixture(notes: string): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-export-jsdoc-'))
  roots.push(root)
  const source = join(root, 'packages', 'group', 'tool', 'src')
  mkdirSync(source, { recursive: true })
  writeFileSync(join(source, 'index.ts'), [
    '/** Fixture service. */',
    'export class FixtureService {',
    '  run(value: string): string { return value }',
    '}',
    '',
  ].join('\n'))
  if (notes !== '') {
    const docs = join(root, 'docs', 'code-notes')
    mkdirSync(docs, { recursive: true })
    writeFileSync(join(docs, 'api.md'), notes)
  }
  return root
}

function apiDoc(anchor: string): string {
  return [
    '```api-doc',
    anchor,
    'Runs the fixture operation.',
    '@param value - the input value.',
    '@returns the resulting value.',
    '```',
  ].join('\n')
}

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true })
})

describe('verify-export-jsdoc code-note API docs', () => {
  it('uses a valid code-note contract for an exported method', () => {
    const root = fixture(apiDoc('packages/group/tool/src/index.ts:FixtureService.run'))
    expect(collectExportJsdocViolations(root)).toEqual([])
  })

  it('rejects malformed source anchors', () => {
    const root = fixture(apiDoc('packages/group/tool/src/../index.ts:FixtureService.run'))
    expect(collectExportJsdocViolations(root)).toContain('docs/code-notes/api.md has an api-doc block with an invalid source anchor.')
  })

  it('rejects duplicate anchors', () => {
    const note = apiDoc('packages/group/tool/src/index.ts:FixtureService.run')
    const root = fixture(`${note}\n\n${note}`)
    expect(collectExportJsdocViolations(root)).toContain("docs/code-notes/api.md defines the api-doc anchor 'packages/group/tool/src/index.ts:FixtureService.run' more than once.")
  })

  it('rejects anchors that do not match an undocumented export', () => {
    const root = fixture(apiDoc('packages/group/tool/src/index.ts:FixtureService.missing'))
    expect(collectExportJsdocViolations(root)).toContain("code-notes API doc 'packages/group/tool/src/index.ts:FixtureService.missing' does not match an undocumented exported declaration.")
  })
})

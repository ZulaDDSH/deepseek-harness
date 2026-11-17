import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { collectExportJsdocViolations } from './verify-export-jsdoc.ts'

const roots: string[] = []

function fixture(source: string, notes: string, otherNotes?: string): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-export-jsdoc-'))
  roots.push(root)
  mkdirSync(join(root, 'packages/test/example/src'), { recursive: true })
  mkdirSync(join(root, 'docs/code-notes'), { recursive: true })
  writeFileSync(join(root, 'packages/test/example/src/index.ts'), source)
  writeFileSync(join(root, 'docs/code-notes/mcp-export-contracts.md'), notes)
  if (otherNotes !== undefined) writeFileSync(join(root, 'docs/code-notes/other-export-contracts.md'), otherNotes)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('export JSDoc code-note fallback', () => {
  it('accepts a complete anchored contract when source JSDoc is absent', () => {
    const root = fixture(
      'export function run(value: string): string { return value }\n',
      '### `packages/test/example/src/index.ts:run`\n- `description`: Runs the operation.\n- `params.value`: The input value.\n- `returns`: The resulting value.\n',
    )
    expect(collectExportJsdocViolations(root)).toEqual([])
  })

  it('loads separate export contracts from both code-notes files', () => {
    const root = fixture(
      'export function run(value: string): string { return value }\nexport type Other = string\n',
      '### `packages/test/example/src/index.ts:run`\n- `description`: Runs the operation.\n- `params.value`: The input value.\n- `returns`: The resulting value.\n',
      '### `packages/test/example/src/index.ts:Other`\n- `description`: An alternate value.\n',
    )
    expect(collectExportJsdocViolations(root)).toEqual([])
  })

  it('rejects duplicate anchors across the two code-notes files', () => {
    const root = fixture(
      'export function run(): void {}\n',
      '### `packages/test/example/src/index.ts:run`\n- `description`: Runs the operation.\n',
      '### `packages/test/example/src/index.ts:run`\n- `description`: Runs the operation.\n',
    )
    expect(() => collectExportJsdocViolations(root)).toThrow('duplicate code-note anchor')
  })

  it('still rejects missing parameter and return documentation in notes', () => {
    const root = fixture(
      'export function run(value: string): string { return value }\n',
      '### `packages/test/example/src/index.ts:run`\n- `description`: Runs the operation.\n',
    )
    const violations = collectExportJsdocViolations(root).join('\n')
    expect(violations).toContain('missing @param value')
    expect(violations).toContain('missing @returns')
  })

  it('fills missing parameter and return docs without replacing source prose', () => {
    const root = fixture(
      '/** Runs the operation. */\nexport function run(value: string): string { return value }\n',
      '### `packages/test/example/src/index.ts:run`\n- `description`: Runs the operation.\n- `params.value`: The input value.\n- `returns`: The resulting value.\n',
    )
    const violations = collectExportJsdocViolations(root).join('\n')
    expect(violations).toBe('')
  })

  it('fills missing prose while retaining source parameter descriptions', () => {
    const root = fixture(
      '/** @param value - The authored input. */\nexport function run(value: string): string { return value }\n',
      '### `packages/test/example/src/index.ts:run`\n- `description`: Runs the operation.\n- `returns`: The resulting value.\n',
    )
    expect(collectExportJsdocViolations(root)).toEqual([])
  })

  it('rejects note anchors that do not match an exported declaration', () => {
    const root = fixture(
      'export function run(): void {}\n',
      '### `packages/test/example/src/index.ts:missing`\n- `description`: No such export.\n',
    )
    expect(collectExportJsdocViolations(root).join('\n')).toContain('does not match an exported declaration')
  })

  it('rejects unsupported and stale note fields', () => {
    const root = fixture(
      'export function run(value: string): void {}\n',
      '### `packages/test/example/src/index.ts:run`\n- `description`: Runs the operation.\n- `params.missing`: A stale parameter.\n- `reason`: An unsupported field.\n',
    )
    const violations = collectExportJsdocViolations(root).join('\n')
    expect(violations).toContain("unsupported field 'reason'")
    expect(violations).toContain('@param missing does not match any parameter')
    expect(violations).toContain('missing @param value')
  })
})

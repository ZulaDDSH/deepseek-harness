import { describe, expect, it } from 'vitest'
import { parseAnchoredFieldNotes } from './code-notes.ts'

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

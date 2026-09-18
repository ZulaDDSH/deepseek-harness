import { describe, expect, it } from 'vitest'
import { resolveToolFilter, toolAllowed } from '@deepseek-ai/dsh-mcp-client/src/tool-filter.ts'

describe('MCP tool filter resolution', () => {
  it('resolves the omitted filter to an immutable allow-all policy', () => {
    const filter = resolveToolFilter(undefined, 'toolFilter')

    expect(filter).toEqual({ deny: [] })
    expect(Object.isFrozen(filter)).toBe(true)
    expect(Object.isFrozen(filter.deny)).toBe(true)
    expect(toolAllowed(filter, 'anything')).toBe(true)
    expect(toolAllowed(undefined, 'anything')).toBe(true)
  })

  it('applies allow before deny and freezes configured names', () => {
    const filter = resolveToolFilter({
      allow: ['read', 'write'],
      deny: ['write'],
    }, 'toolFilter')

    expect(filter).toEqual({ allow: ['read', 'write'], deny: ['write'] })
    expect(Object.isFrozen(filter.allow)).toBe(true)
    expect(Object.isFrozen(filter.deny)).toBe(true)
    expect(toolAllowed(filter, 'read')).toBe(true)
    expect(toolAllowed(filter, 'write')).toBe(false)
    expect(toolAllowed(filter, 'other')).toBe(false)
  })

  it('supports a deny-only filter', () => {
    const filter = resolveToolFilter({ deny: ['blocked'] }, 'toolFilter')

    expect(toolAllowed(filter, 'allowed')).toBe(true)
    expect(toolAllowed(filter, 'blocked')).toBe(false)
  })

  it.each([
    [{ extra: [] }, /toolFilter\.extra is not a tool filter option/],
    [{ allow: 'read' }, /toolFilter\.allow must be an array/],
    [{ allow: [1] }, /toolFilter\.allow\[0\] must be a non-empty string/],
    [{ allow: [''] }, /toolFilter\.allow\[0\] must be a non-empty string/],
    [{ allow: ['read', 'read'] }, /toolFilter contains duplicate tool name "read"/],
  ])('rejects malformed filters %#', (input, pattern) => {
    expect(() => resolveToolFilter(input as never, 'toolFilter')).toThrow(pattern)
  })
})

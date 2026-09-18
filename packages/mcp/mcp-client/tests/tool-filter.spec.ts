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

  it('supports one-sided filters and treats an empty allow list as unrestricted', () => {
    const denyOnly = resolveToolFilter({ deny: ['blocked'] }, 'toolFilter')
    const allowOnly = resolveToolFilter({ allow: ['read'] }, 'toolFilter')
    const schemaDefault = resolveToolFilter({ allow: [], deny: [] }, 'toolFilter')

    expect(toolAllowed(denyOnly, 'allowed')).toBe(true)
    expect(toolAllowed(denyOnly, 'blocked')).toBe(false)
    expect(allowOnly).toEqual({ allow: ['read'], deny: [] })
    expect(toolAllowed(allowOnly, 'read')).toBe(true)
    expect(schemaDefault).toEqual({ deny: [] })
    expect(toolAllowed(schemaDefault, 'anything')).toBe(true)
  })

  it.each([
    [{ extra: [] }, /toolFilter\.extra is not a tool filter option/],
    [{ allow: 'read' }, /toolFilter\.allow must be an array/],
    [{ allow: [1] }, /toolFilter\.allow\[0\] must be a non-empty string/],
    [{ allow: [''] }, /toolFilter\.allow\[0\] must be a non-empty string/],
    [{ allow: ['read', 'read'] }, /toolFilter\.allow contains duplicate tool name "read"/],
  ])('rejects malformed filters %#', (input, pattern) => {
    expect(() => resolveToolFilter(input as never, 'toolFilter')).toThrow(pattern)
  })
})

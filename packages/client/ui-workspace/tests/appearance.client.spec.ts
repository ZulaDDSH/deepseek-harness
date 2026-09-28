import { describe, expect, it } from 'vitest'
import { isWorkspaceColor, isWorkspaceIcon, WORKSPACE_COLORS, WORKSPACE_ICONS } from '../src/client/appearance.ts'

describe('stored Workspace appearance', () => {
  it('accepts the supported vocabulary and rejects unknown strings and nonstrings', () => {
    for (const color of WORKSPACE_COLORS) expect(isWorkspaceColor(color)).toBe(true)
    for (const icon of WORKSPACE_ICONS) expect(isWorkspaceIcon(icon)).toBe(true)
    for (const value of [null, 1, '', 'unknown']) {
      expect(isWorkspaceColor(value)).toBe(false)
      expect(isWorkspaceIcon(value)).toBe(false)
    }
  })
})

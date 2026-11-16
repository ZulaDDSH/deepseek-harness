import { describe, expect, it } from 'vitest'
import { ALL_HOOKS, describeHookHandlers, hookEnabled, hookKey } from '@deepseek-ai/dsh-hook-protocol'

describe('hook enablement', () => {
  const key = hookKey('PreToolUse', 'Bash', 'guard')

  it('denies by default and runs only allow-listed or wildcard hooks', () => {
    expect(hookEnabled(key, [])).toBe(false)
    expect(hookEnabled(key, [key])).toBe(true)
    expect(hookEnabled(key, [ALL_HOOKS])).toBe(true)
  })

  it('lets a session override win in both directions', () => {
    expect(hookEnabled(key, [], { [key]: true })).toBe(true)
    expect(hookEnabled(key, [ALL_HOOKS], { [key]: false })).toBe(false)
  })

  it('reports the same enablement the bridges apply', () => {
    const config = { PreToolUse: [{ matcher: 'Bash', hooks: [{ command: 'guard' }] }] }
    expect(describeHookHandlers(config)[0]).toMatchObject({ key, disabled: true })
    expect(describeHookHandlers(config, [ALL_HOOKS], { [key]: 'Blocks risky tools' })[0])
      .toEqual({ event: 'PreToolUse', matcher: 'Bash', command: 'guard', key, description: 'Blocks risky tools' })
  })
})

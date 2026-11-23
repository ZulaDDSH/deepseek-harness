import { describe, expect, it, vi } from 'vitest'
import { createHookWrites, enabledAfterDisableAll, enabledAfterEnableAll, enabledAfterSwitch } from '../src/client/hook-writes.ts'

interface PathOp { readonly op: 'set' | 'unset'; readonly path: readonly string[]; readonly value?: unknown }

function apply(section: Record<string, unknown>, op: PathOp): void {
  const [head, key] = op.path
  if (head === undefined) return
  if (key === undefined) {
    if (op.op === 'set') section[head] = op.value
    else delete section[head]
    return
  }
  const dict = (section[head] ?? {}) as Record<string, unknown>
  section[head] = dict
  if (op.op === 'set') dict[key] = op.value
  else delete dict[key]
}

function fakeSettings(initial: Record<string, unknown>) {
  const state = { section: structuredClone(initial), revision: 1 }
  let onMutate: (() => void) | undefined
  const describe = vi.fn(async () => ({
    ok: true as const,
    value: { writable: true, hasDocument: true, namespaces: [{ ns: 'hooks-1', value: structuredClone(state.section), revision: state.revision }] },
  }))
  const mutate = vi.fn(async (_ns: string, ops: readonly PathOp[], expected: number | undefined) => {
    onMutate?.()
    if (expected !== undefined && expected !== state.revision) {
      return { ok: false as const, error: { code: 'settings/conflict', message: `expected ${expected}, now ${state.revision}` } }
    }
    for (const op of ops) apply(state.section, op)
    state.revision++
    return { ok: true as const, value: {} }
  })
  return { settings: { describe, mutate }, state, mutate, setOnMutate: (next: (() => void) | undefined) => { onMutate = next } }
}

const visible = ['k1', 'k2', 'k3']

describe('hook enablement writes', () => {
  it('keeps a hook another client enabled after the page was read', async () => {
    const fake = fakeSettings({ enabledHooks: ['k2'] })
    const writes = createHookWrites(fake.settings)
    fake.state.section.enabledHooks = ['k2', 'k9']
    fake.state.revision++
    await writes.updateEnabledHooks('hooks-1', stored => [...stored, 'k1'])
    expect(fake.state.section.enabledHooks).toEqual(['k2', 'k9', 'k1'])
  })

  it('keeps stored hooks the inventory does not list when another row changes', async () => {
    const fake = fakeSettings({ enabledHooks: ['gone', 'k1'] })
    const writes = createHookWrites(fake.settings)
    await writes.updateEnabledHooks('hooks-1', stored => enabledAfterSwitch(stored, ['k1', 'k2'], ['k1'], false))
    expect(fake.state.section.enabledHooks).toEqual(['gone'])
    await writes.updateEnabledHooks('hooks-1', stored => enabledAfterSwitch(stored, ['k1', 'k2'], ['k2'], true))
    expect(fake.state.section.enabledHooks).toEqual(['gone', 'k2'])
  })

  it('recomputes from the stored list when it changes between the read and the write', async () => {
    const fake = fakeSettings({ enabledHooks: ['k2'] })
    const writes = createHookWrites(fake.settings)
    fake.setOnMutate(() => {
      fake.state.section.enabledHooks = ['k9']
      fake.state.revision++
      fake.setOnMutate(undefined)
    })
    await writes.updateEnabledHooks('hooks-1', stored => [...stored, 'k1'])
    expect(fake.mutate).toHaveBeenCalledTimes(2)
    expect(fake.state.section.enabledHooks).toEqual(['k9', 'k1'])
  })

  it('gives up after repeated conflicts instead of overwriting', async () => {
    const fake = fakeSettings({ enabledHooks: [] })
    const writes = createHookWrites(fake.settings)
    fake.setOnMutate(() => { fake.state.revision++ })
    await expect(writes.updateEnabledHooks('hooks-1', stored => [...stored, 'k1'])).rejects.toThrow('settings/conflict')
    expect(fake.mutate).toHaveBeenCalledTimes(3)
    expect(fake.state.section.enabledHooks).toEqual([])
  })

  it('surfaces a refused write with the Host message', async () => {
    const fake = fakeSettings({ enabledHooks: [] })
    fake.mutate.mockResolvedValueOnce({ ok: false as const, error: { code: 'settings/refused', message: 'no' } })
    const writes = createHookWrites(fake.settings)
    await expect(writes.updateEnabledHooks('hooks-1', stored => [...stored, 'k1'])).rejects.toThrow('settings.mutate failed: settings/refused: no')
  })

  it('expands the allow-all entry only when a single hook is switched off or all are disabled', () => {
    expect(enabledAfterSwitch(['*'], visible, ['k1'], false)).toEqual(['k2', 'k3'])
    expect(enabledAfterSwitch(['*'], visible, ['k1'], true)).toEqual(['*'])
    expect(enabledAfterEnableAll(['*'], visible)).toEqual(['*'])
    expect(enabledAfterDisableAll(['*'], visible)).toEqual([])
    expect(enabledAfterDisableAll(['gone', 'k2'], visible)).toEqual(['gone'])
    expect(enabledAfterEnableAll(['gone'], visible)).toEqual(['gone', 'k1', 'k2', 'k3'])
  })

  it('writes description changes per hook without restating the others', async () => {
    const fake = fakeSettings({ hookDescriptions: { absent: 'keep', k1: 'old' } })
    const writes = createHookWrites(fake.settings)
    await writes.setHookDescriptions('hooks-1', ['k1', 'k2'], 'new')
    expect(fake.state.section.hookDescriptions).toEqual({ absent: 'keep', k1: 'new', k2: 'new' })
    expect(fake.mutate.mock.calls[0]?.[2]).toBeUndefined()
    await writes.setHookDescriptions('hooks-1', ['k1'], undefined)
    expect(fake.state.section.hookDescriptions).toEqual({ absent: 'keep', k2: 'new' })
  })

  it('keeps a description another client wrote for a different hook', async () => {
    const fake = fakeSettings({ hookDescriptions: { k3: 'theirs' } })
    const writes = createHookWrites(fake.settings)
    fake.state.section.hookDescriptions = { k3: 'theirs', k9: 'later' }
    fake.state.revision++
    await writes.setHookDescriptions('hooks-1', ['k1'], 'mine')
    expect(fake.state.section.hookDescriptions).toEqual({ k3: 'theirs', k9: 'later', k1: 'mine' })
  })
})

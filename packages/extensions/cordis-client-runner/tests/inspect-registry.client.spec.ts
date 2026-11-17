import { describe, expect, it, vi } from 'vitest'
import { ClientCordisInspectRegistry } from '../src/client/inspect-registry.ts'

describe('ClientCordisInspectRegistry', () => {
  it('does not publish after disposal', async () => {
    const sync = vi.fn(async () => {})
    const registry = new ClientCordisInspectRegistry({
      sync,
      resolve: async () => {},
    })

    registry.register({
      manifest: { id: 'provider', description: 'provider', methods: [] },
      query: async () => null,
    })
    registry.dispose()
    await Promise.resolve()

    expect(sync).not.toHaveBeenCalled()
  })
})

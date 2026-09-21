import { Context } from '@deepseek-ai/cordis'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import { describe, expect, it, vi } from 'vitest'
import { QuotaController } from '../src/index.ts'

describe('QuotaController credential resolution', () => {
  it('lists and fetches a provider signed in through the Models page record', async () => {
    const key = credentialKey('llm-pi-ai', 'opencode-go')
    const credentials = {
      resolve: vi.fn(async () => undefined),
      readRecord: vi.fn(async (requested: typeof key) => requested === key
        ? { kind: 'api-key' as const, key: 'stored-opencode-key' }
        : undefined),
    }
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer stored-opencode-key')
      return new Response(JSON.stringify({ usage: { rolling: { percent: 12, resetsAt: '2026-09-18T12:00:00Z' } } }), { status: 200 })
    })
    const ctx = new Context()
    ctx.provide('credentials', credentials as never)
    const controller = new QuotaController(ctx, { fetch: fetchImpl })

    await expect(controller.listProviders()).resolves.toEqual([{ id: 'opencode-go', name: 'OpenCode Go' }])
    await expect(controller.fetch('opencode-go')).resolves.toMatchObject({
      providerId: 'opencode-go', configured: true, ok: true, windows: { '5h': { usedPercent: 12 } },
    })
    expect(credentials.resolve).toHaveBeenCalled()
    expect(credentials.readRecord).toHaveBeenCalledWith(key)
  })
})

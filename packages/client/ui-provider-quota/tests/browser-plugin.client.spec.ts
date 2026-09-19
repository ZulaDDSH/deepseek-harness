import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '../src/client/index.ts'
import { ProviderQuotaAction } from '../src/client/ProviderQuotaAction.tsx'
import { en, NS, zh } from '../src/client/locales.ts'

afterEach(() => { vi.restoreAllMocks() })

async function boot(): Promise<{ ctx: Context; fiber: ReturnType<Context['plugin']> }> {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({ name: 'root', children: { 'conversation.session.header.utilities': { kind: 'list', scope: 'session' } } } as never, () => null)
  const remote = {
    quota: {
      listProviders: vi.fn(async () => ({ ok: true as const, value: [{ id: 'opencode-go', name: 'OpenCode Go' }] })),
      fetch: vi.fn(async () => ({ ok: true as const, value: { providerId: 'opencode-go', providerName: 'OpenCode Go', configured: true, ok: true, windows: { '5h': { usedPercent: 12, resetAt: null } } } })),
    },
  }
  ctx.provide('locale', new LocaleRuntime(ctx))
  ctx.provide('remote', remote)
  ctx.provide('remote.quota', remote.quota)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, fiber }
}

describe('provider quota browser half', () => {
  it('registers the localized header action and removes it on teardown', async () => {
    const { ctx, fiber } = await boot()
    expect(ctx.slots.entries('conversation.session.header.utilities')[0]?.component).toBe(ProviderQuotaAction)
    expect(ctx.slots.entries('conversation.session.header.utilities')[0]?.options.id).toBe('provider-quota')
    ctx.locale.setLocale('en')
    expect(ctx.locale.bind(NS)('title')).toBe(en.title)
    ctx.locale.setLocale('zh')
    expect(ctx.locale.bind(NS)('title')).toBe(zh.title)
    await fiber.dispose()
    expect(ctx.slots.entries('conversation.session.header.utilities')).toHaveLength(0)
  })
})

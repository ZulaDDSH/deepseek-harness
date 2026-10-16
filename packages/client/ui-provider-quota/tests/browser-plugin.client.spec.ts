import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '../src/client/index.ts'
import { ProviderQuotaAction } from '../src/client/ProviderQuotaAction.tsx'
import type { ProviderQuotaActionInjected } from '../src/client/ProviderQuotaAction.tsx'
import { UsageSwitchPrompt } from '../src/client/UsageSwitchPrompt.tsx'
import type { UsageSwitchPromptInjected } from '../src/client/UsageSwitchPrompt.tsx'
import { UsageLimitCard } from '../src/client/UsageLimitCard.tsx'
import { apply as applyHost } from '../src/index.ts'
import { en, NS, zh } from '../src/client/locales.ts'

afterEach(() => { vi.restoreAllMocks() })

async function boot(): Promise<{ ctx: Context; fiber: ReturnType<Context['plugin']> }> {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({ name: 'root', children: {
    'conversation.session.header.utilities': { kind: 'list', scope: 'session' },
    'conversation.input.dock': { kind: 'list', scope: 'session' },
    'plugins.item': { kind: 'list', scope: 'root' },
  } } as never, () => null)
  const scope = {
    getSnapshot: () => ({ status: 'ready' as const, value: { nearLimitPercent: 80 }, base: {}, user: undefined, revision: 1, writable: true }),
    subscribe: () => () => {},
    mutate: vi.fn(async () => true),
  }
  const configForms = {
    get: vi.fn(() => scope),
    whileServed: (namespaces: readonly string[], register: (served: ReadonlySet<string>) => () => void) => register(new Set(namespaces)),
  }
  ctx.provide('configForms', configForms as never)
  const remote = {
    quota: {
      listProviders: vi.fn(async () => ({ ok: true as const, value: [{ id: 'opencode-go', name: 'OpenCode Go' }] })),
      fetch: vi.fn(async () => ({ ok: true as const, value: { providerId: 'opencode-go', providerName: 'OpenCode Go', configured: true, ok: true, windows: { '5h': { usedPercent: 12, resetAt: null } } } })),
    },
    settings: { mutate: vi.fn(async () => ({ ok: true as const, value: {} })) },
  }
  ctx.provide('locale', new LocaleRuntime(ctx))
  ctx.provide('remote', remote)
  ctx.provide('remote.quota', remote.quota)
  ctx.provide('remote.settings', remote.settings)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, fiber }
}

describe('provider quota browser half', () => {
  it('registers the localized header action and removes it on teardown', async () => {
    const { ctx, fiber } = await boot()
    expect(ctx.slots.entries('conversation.session.header.utilities')[0]?.component).toBe(ProviderQuotaAction)
    expect(ctx.slots.entries('conversation.session.header.utilities')[0]?.options.id).toBe('provider-quota')
    const injectAction = ctx.slots.entries('conversation.session.header.utilities')[0]?.inject as (() => ProviderQuotaActionInjected) | undefined
    if (injectAction === undefined) throw new Error('quota action injection was not registered')
    const injected = injectAction()
    await injected.refresh()
    expect(injected.hooks.providers.getSnapshot()).toEqual([{ id: 'opencode-go', name: 'OpenCode Go' }])
    expect(injected.hooks.state.getSnapshot().status).toBe('ready')
    applyHost()
    ctx.locale.setLocale('en')
    expect(ctx.locale.bind(NS)('title')).toBe(en.title)
    ctx.locale.setLocale('zh')
    expect(ctx.locale.bind(NS)('title')).toBe(zh.title)
    await fiber.dispose()
    expect(ctx.slots.entries('conversation.session.header.utilities')).toHaveLength(0)
  })

  it('registers the usage prompt in the composer dock and removes it on teardown', async () => {
    const { ctx, fiber } = await boot()
    const entry = ctx.slots.entries('conversation.input.dock')[0]
    expect(entry?.component).toBe(UsageSwitchPrompt)
    expect(entry?.options.id).toBe('usage')
    const injectPrompt = entry?.inject as (() => UsageSwitchPromptInjected) | undefined
    if (injectPrompt === undefined) throw new Error('usage prompt injection was not registered')
    const injected = injectPrompt()
    expect(injected.hooks.nearLimit.getSnapshot()).toBe(80)
    injected.dismiss('limit|anthropic|5h|1')
    expect(injected.hooks.dismissed.getSnapshot()).toEqual(['limit|anthropic|5h|1'])
    await fiber.dispose()
    expect(ctx.slots.entries('conversation.input.dock')).toHaveLength(0)
  })

  it('mounts the usage warning page on the Plugins page and removes it on teardown', async () => {
    const { ctx, fiber } = await boot()
    const page = ctx.slots.entries('plugins.item')[0]
    expect(page?.options.id).toBe('provider-quota')
    expect(page?.component).toBe(UsageLimitCard)
    await fiber.dispose()
    expect(ctx.slots.entries('plugins.item')).toHaveLength(0)
  })
})

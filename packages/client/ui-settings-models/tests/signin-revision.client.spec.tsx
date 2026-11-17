// @vitest-environment jsdom
/**
 * A sign-in another tab completed reaches a mounted Models card.
 *
 * The assembled renderer memoizes a root-scope entry's inject result for the
 * whole registration, so a credential fact read once at first render would
 * freeze there — and `settings.section` is root-scoped. This spec drives the
 * real slot renderer (not a direct `entry.inject()` call, which bypasses that
 * memo) and pins that a record update the Host pushes after first render
 * reaches the mounted card.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, within } from '@testing-library/react'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { remoteDefaultResponses } from '@deepseek-ai/dsh-client-test-runtime/src/assembly/remote-default-responses.ts'
import { ok, RemoteMock } from '@deepseek-ai/dsh-remote-mock'
import Schema from '@deepseek-ai/schemastery'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply as settingsApply, inject as settingsInject } from '@deepseek-ai/dsh-client-ui-settings/client'
import { apply, inject } from '../src/client/index.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const PiAiConfig = Schema.object({
  providers: Schema.dict(Schema.object({
    apiKey: Schema.string().role('secret'),
    apiKeyEnv: Schema.string().role('credential-ref'),
    displayName: Schema.string(),
    api: Schema.union(['openai-completions', 'openai-responses', 'anthropic-messages']),
    baseURL: Schema.string(),
    models: Schema.array(Schema.object({
      id: Schema.string().required(),
      name: Schema.string(),
      contextWindow: Schema.number(),
      maxTokens: Schema.number(),
    })),
    reasoning: Schema.union(['off', 'high']),
  })),
})

const ENTRY = {
  key: 'llm-pi-ai/openai-codex',
  label: 'OpenAI Codex',
  methods: [{ id: 'oauth', label: 'Sign in with ChatGPT' }],
  inFlight: false,
}

/**
 * Boot the shipped plugin on the real slot runtime with one authorization flow.
 * @returns the runtime, the mounted section view, and the credential/list controls.
 */
async function bench(): Promise<{
  runtime: SlotTestRuntime
  view: ReturnType<SlotTestRuntime['renderSlot']>
  signIn: () => void
  listCalls: () => number
}> {
  const runtime = await SlotTestRuntime.create()
  const locale = new LocaleRuntime(runtime.ctx)
  locale.setLocale('en')
  runtime.ctx.provide('locale', locale)
  runtime.slots.installLocale(locale)

  const mock = RemoteMock.create().load(remoteDefaultResponses)
  mock.remote.settings.describe.mockResolvedValue(ok({
    writable: true,
    hasDocument: false,
    namespaces: [{
      ns: 'llm-pi-ai',
      schema: JSON.parse(JSON.stringify(PiAiConfig.toJSON())) as never,
      value: { providers: { 'openai-codex': { apiKeyEnv: 'OPENAI_API_KEY' } } },
      applies: 'live',
      autoGenerate: false,
      secrets: [],
      revision: 0,
    }],
  }))

  let configured = false
  let listCalls = 0
  runtime.remote.provideNamespaces({
    authorization: {
      list: () => {
        listCalls += 1
        return Promise.resolve({ ok: true as const, value: [{ ...ENTRY, configured }] })
      },
      answer: () => Promise.resolve({ ok: true as const, value: undefined }),
      cancel: () => Promise.resolve({ ok: true as const, value: undefined }),
    },
    credentials: {
      describe: () => Promise.resolve({ ok: true as const, value: {} }),
      set: () => Promise.resolve({ ok: true as const, value: undefined }),
      unset: () => Promise.resolve({ ok: true as const, value: undefined }),
    },
    session: {
      modelCatalog: () => Promise.resolve(ok({ groups: [] })),
    },
    llm: {
      listProviders: () => Promise.resolve(ok([{ id: 'openai-codex', name: 'openai-codex' }])),
      listConfigurableProviders: () => Promise.resolve(ok([{
        provider: 'openai-codex',
        displayName: 'openai-codex',
        settingsNs: 'llm-pi-ai',
        settingsPath: ['providers', 'openai-codex'],
      }])),
      discoverModels: () => Promise.resolve(ok([])),
    },
    settings: mock.remote.settings,
  })
  runtime.remote.$host = { home: undefined, isLoopback: true }

  await runtime.mount({ inject: [...settingsInject], apply: settingsApply })
  await runtime.declare({ 'settings.section': { kind: 'list', scope: 'root' } } as never)
  await runtime.mount({ inject: [...inject], apply })
  const view = runtime.renderSlot('settings.section', { close: () => {} })
  return {
    runtime,
    view,
    signIn: () => { configured = true },
    listCalls: () => listCalls,
  }
}

describe('a sign-in from another tab on the assembled Models section', () => {
  it('turns the mounted card to signed in on a pushed record update', async () => {
    const { runtime, view, signIn, listCalls } = await bench()
    const scoped = within(view.container)

    // Open the provider row's editor, which mounts its sign-in card on the
    // pre-login state the Host reported at first render.
    fireEvent.click(await scoped.findByRole('button', { name: 'Edit openai-codex' }))
    expect(runtime.ctx.get('remote.authorization')).toBeTruthy()
    expect(await scoped.findByText(en.signedOut)).toBeTruthy()

    // A second tab signs in: the Host commits a credential record and pushes
    // the update this page subscribes to.
    const readsBefore = listCalls()
    signIn()
    runtime.remote.emit('credentials/record-updated', ['llm-pi-ai/openai-codex'])

    expect(await scoped.findByText(en.signedIn)).toBeTruthy()
    expect(scoped.queryByText(en.signedOut)).toBeNull()
    expect(listCalls()).toBeGreaterThan(readsBefore)
  })
})

// @vitest-environment jsdom (must stay the first line)
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Schema from '@deepseek-ai/schemastery'
import { Context } from '@deepseek-ai/cordis'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import type { SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import type { AuthorizationEntryView } from '@deepseek-ai/dsh-api-settings-controller/types'
import { SettingsDescribeMirror } from '@deepseek-ai/dsh-client-ui-settings/src/client/settings-mirror.ts'
import { ModelsSection } from '../src/client/ModelsSection.tsx'
import type { ModelsSectionInjected, ModelsSectionProps } from '../src/client/ModelsSection.tsx'
import { ModelsSettingsStore } from '../src/client/store.ts'
import type { ProviderRow } from '../src/client/store.ts'
import type { AuthorizationOperations } from '../src/client/authorization-operations.ts'
import type { ModelsOperations } from '../src/client/operations.ts'
import { en } from '../src/client/locales.ts'
import { settingsSchema } from './settings-schema.client.ts'

afterEach(cleanup)

const t: ModelsSectionInjected['t'] = key => en[key]

const PiAiConfig = Schema.object({
  providers: Schema.dict(Schema.object({
    apiKeyEnv: Schema.string().role('credential-ref'),
    displayName: Schema.string(),
  })),
})
const DeepSeekConfig = Schema.object({
  apiKeyEnv: Schema.string().role('credential-ref'),
  models: Schema.array(Schema.object({ id: Schema.string() })),
})

function namespace(ns: string, schema: { toJSON(): unknown }, value: JsonValue): SettingsNamespaceView {
  return {
    ns,
    autoGenerate: true,
    schema: JSON.parse(JSON.stringify(schema.toJSON())) as JsonValue,
    value,
    base: value,
    user: value,
    applies: 'live',
    secrets: [],
    revision: 0,
  }
}

function row(provider: string, settingsNs: string, settingsPath: string[]): ProviderRow {
  return {
    entry: { provider, displayName: provider, settingsNs, settingsPath, active: false },
    configured: true,
    removable: false,
    apiKeyEnv: undefined,
    credential: undefined,
  }
}

const operations: ModelsOperations = {
  storeCredential: () => Promise.resolve(undefined),
  removeCredential: () => Promise.resolve(undefined),
  writeSettings: () => Promise.resolve({ kind: 'refused', message: 'not scripted' }),
  discoverModels: () => Promise.resolve({ kind: 'refused', message: 'discovery is not scripted' }),
}

function authorizationFor(flow: AuthorizationEntryView): AuthorizationOperations {
  return {
    list: () => Promise.resolve([flow]),
    begin: () => new Promise<never>(() => undefined),
    answer: () => Promise.reject(new Error('answer is not scripted')),
    cancel: () => Promise.resolve(),
  }
}

function mount(rows: ProviderRow[], namespaces: SettingsNamespaceView[], authorization: AuthorizationOperations): void {
  const ctx = new Context()
  const controller = new ModelsSettingsStore(ctx, settingsSchema, new SettingsDescribeMirror(ctx))
  controller.store.update((state) => {
    state.status = 'ready'
    state.writable = true
    state.rows = rows
    state.namespaces = new Map(namespaces.map(view => [view.ns, view]))
  })
  vi.spyOn(controller, 'load').mockResolvedValue()
  const props: ModelsSectionProps = {
    controller,
    useSnapshot: bindSnapshotSelector(controller.store),
    useCredentialsRevision: bindSnapshotSelector(createSnapshotStore({ revision: 0 })),
    operations,
    authorization,
    schema: settingsSchema,
    t,
    renderSlot: () => null,
  }
  render(<ModelsSection {...props} />)
}

describe('the llm-pi-ai row sign-in card', () => {
  it('opens the row editor and focuses its key field from the row sign-in card', async () => {
    const pi = namespace('llm-pi-ai', PiAiConfig, { providers: { openai: {} } })
    mount(
      [row('openai', 'llm-pi-ai', ['providers', 'openai'])],
      [pi],
      authorizationFor({
        key: 'llm-pi-ai/openai',
        label: 'openai',
        methods: [{ id: 'oauth', label: 'Sign in' }],
        inFlight: false,
        configured: true,
        kind: 'grant',
        borrowedFrom: 'Claude Code',
      }),
    )

    expect(screen.queryByLabelText(en.keyInput)).toBeNull()
    fireEvent.click(await screen.findByRole('button', { name: en.borrowedUseApiKey }))
    const key = await screen.findByLabelText(en.keyInput)
    await waitFor(() => { expect(document.activeElement).toBe(key) })
    expect(screen.getAllByRole('button', { name: en.borrowedUseApiKey })).toHaveLength(1)

    key.blur()
    fireEvent.click(screen.getByRole('button', { name: en.borrowedUseApiKey }))
    await waitFor(() => { expect(document.activeElement).toBe(key) })
    expect(screen.getByLabelText(en.keyInput)).toBe(key)

    fireEvent.click(screen.getByRole('button', { name: 'Edit openai' }))
    expect(screen.queryByLabelText(en.keyInput)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Edit openai' }))
    expect(document.activeElement).not.toBe(await screen.findByLabelText(en.keyInput))
  })

  it('keeps the editor sign-in card for a provider outside the llm-pi-ai row card', async () => {
    const deepseek = namespace('llm-deepseek', DeepSeekConfig, { models: [] })
    const deepseekRow: ProviderRow = {
      ...row('deepseek-official', 'llm-deepseek', []),
      credential: { configured: true, writable: true },
    }
    mount(
      [deepseekRow],
      [deepseek],
      authorizationFor({
        key: 'llm-deepseek/deepseek-official',
        label: 'deepseek-official',
        methods: [{ id: 'oauth', label: 'Sign in' }],
        inFlight: false,
        configured: false,
      }),
    )

    expect(screen.queryByRole('button', { name: en.signIn })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Edit deepseek-official' }))
    expect(await screen.findByRole('button', { name: en.signIn })).toBeTruthy()
  })
})

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Schema from '@deepseek-ai/schemastery'
import { Context } from '@deepseek-ai/cordis'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import type { SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import { SettingsDescribeMirror } from '@deepseek-ai/dsh-client-ui-settings/src/client/settings-mirror.ts'
import { ModelsSection } from '../src/client/ModelsSection.tsx'
import type { ModelsSectionProps } from '../src/client/ModelsSection.tsx'
import { ProviderEditor } from '../src/client/ProviderEditor.tsx'
import { ModelsSettingsStore } from '../src/client/store.ts'
import type { ProviderRow } from '../src/client/store.ts'
import type { AuthorizationOperations } from '../src/client/authorization-operations.ts'
import type { ModelsOperations } from '../src/client/operations.ts'
import { en } from '../src/client/locales.ts'
import { settingsSchema } from './settings-schema.client.ts'

afterEach(cleanup)

const t: NonNullable<ModelsSectionProps['t']> = key => en[key]

const PiProfile = Schema.object({
  apiKeyEnv: Schema.string(),
  api: Schema.string(),
  baseURL: Schema.string(),
  models: Schema.array(Schema.object({ id: Schema.string() })),
})
const PiConfig = Schema.object({ providers: Schema.dict(PiProfile) })
const DeepSeekConfig = Schema.object({
  apiKeyEnv: Schema.string(),
  models: Schema.array(Schema.object({ id: Schema.string() })),
})
const JevConfig = Schema.object({
  enabled: Schema.boolean(),
  apiKeyEnv: Schema.string(),
  endpoint: Schema.string(),
  model: Schema.string(),
  timeoutMs: Schema.number(),
  minConfidence: Schema.number(),
  stateMaxChars: Schema.number(),
  fallback: Schema.string(),
  failOpen: Schema.boolean(),
  routes: Schema.array(Schema.object({
    id: Schema.string(),
    provider: Schema.string(),
    model: Schema.string(),
    description: Schema.string(),
    reasoningEffort: Schema.string(),
  })),
})

function schemaJson(schema: { toJSON(): unknown }): JsonValue {
  return JSON.parse(JSON.stringify(schema.toJSON())) as JsonValue
}

function namespace(
  ns: string,
  schema: { toJSON(): unknown },
  value: JsonValue,
  user: JsonValue = value,
): SettingsNamespaceView {
  return {
    ns,
    autoGenerate: true,
    schema: schemaJson(schema),
    value,
    base: value,
    user,
    applies: 'live',
    secrets: [],
    revision: 0,
  }
}

function row(
  provider: string,
  settingsNs: string,
  settingsPath: string[],
  configured: boolean,
): ProviderRow {
  return {
    entry: { provider, displayName: provider, settingsNs, settingsPath, active: false },
    configured,
    removable: false,
    apiKeyEnv: undefined,
    credential: undefined,
  }
}

const operations: ModelsOperations = {
  describeCredential: async () => undefined,
  storeCredential: async () => undefined,
  removeCredential: async () => undefined,
  writeSettings: async (_ns, _ops, _revision) => ({ kind: 'refused', message: 'unused' }),
  discoverModels: async () => ({ kind: 'found', models: [] }),
}

function authorization(): AuthorizationOperations {
  const configured = new Set<string>()
  const keys = [
    'llm-deepseek/deepseek-official',
    'llm-pi-ai/openai',
    'llm-pi-ai/anthropic',
  ]
  return {
    list: async () => keys.map(key => ({
      key,
      label: key,
      methods: [{ id: 'oauth', label: 'Sign in' }],
      inFlight: false,
      configured: configured.has(key),
    })),
    begin: async (key, _method, onItem) => {
      onItem({ type: 'start', attempt: 'attempt-1', key })
      onItem({ type: 'end', status: 'authorized' })
      configured.add(key)
      return { kind: 'authorized' }
    },
    answer: async () => ({ kind: 'accepted' }),
    cancel: async () => {},
  }
}

function mount(rows: ProviderRow[], namespaces: SettingsNamespaceView[]) {
  const ctx = new Context()
  const controller = new ModelsSettingsStore(ctx, settingsSchema, new SettingsDescribeMirror(ctx))
  controller.store.update((state) => {
    state.status = 'ready'
    state.writable = true
    state.rows = rows
    state.namespaces = new Map(namespaces.map(view => [view.ns, view]))
  })
  const load = vi.spyOn(controller, 'load').mockResolvedValue()
  const credentials = createSnapshotStore({ revision: 0 })
  const renderSlot: ModelsSectionProps['renderSlot'] = () => null
  const props: ModelsSectionProps = {
    controller,
    useSnapshot: bindSnapshotSelector(controller.store),
    useCredentialsRevision: bindSnapshotSelector(credentials),
    operations,
    authorization: authorization(),
    schema: settingsSchema,
    t,
    renderSlot,
  }
  const view = render(<ModelsSection {...props} />)
  return { view, controller, load }
}

async function completeSignIn(card: HTMLElement): Promise<void> {
  fireEvent.click(await within(card).findByRole('button', { name: en.signIn }))
  await waitFor(() => { expect(card.textContent).toContain(en.signedIn) })
}

describe('Models section integration branches', () => {
  it('offers only model ids from object entries with a nonempty string id', async () => {
    const pi = namespace('llm-pi-ai', PiConfig, {
      providers: { openai: { models: [null, [], {}, { id: '' }, { id: 'usable-model' }] } },
    })
    const jevValue = {
      enabled: true,
      apiKeyEnv: 'TYPESAFE_API_KEY',
      endpoint: 'https://example.test',
      model: 'jev-latest',
      timeoutMs: 1500,
      minConfidence: 0.8,
      stateMaxChars: 12000,
      fallback: 'keep',
      failOpen: true,
      routes: [{
        id: 'route-1', provider: 'openai', model: 'usable-model', description: 'route', reasoningEffort: 'low',
      }],
    }
    const jev = namespace('llm-jev-router', JevConfig, jevValue)
    const jevRow = row('jev-router', 'llm-jev-router', [], true)
    jevRow.entry = { ...jevRow.entry, active: true }
    jevRow.apiKeyEnv = 'TYPESAFE_API_KEY'
    jevRow.credential = { configured: true, writable: true }
    mount(
      [row('openai', 'llm-pi-ai', ['providers', 'openai'], true), jevRow],
      [pi, jev],
    )

    fireEvent.click(screen.getByRole('button', { name: 'Edit jev-router' }))
    const modelField = await screen.findByRole('combobox', { name: 'Route model 1' })
    const listId = modelField.getAttribute('list')
    expect(listId).toBeTruthy()
    const options = [...document.querySelectorAll(`#${listId} option`)].map(option => option.getAttribute('value'))
    expect(options).toEqual(['usable-model'])
  })

  it('refreshes after sign-in from setup, row edit, and add cards', async () => {
    const deepseek = namespace('llm-deepseek', DeepSeekConfig, { models: [] })
    const pi = namespace('llm-pi-ai', PiConfig, {
      providers: {
        openai: { models: [] },
        anthropic: { models: [] },
      },
    })

    const setup = mount([row('deepseek-official', 'llm-deepseek', [], true)], [deepseek])
    await completeSignIn(screen.getByRole('listitem'))
    await waitFor(() => { expect(setup.load).toHaveBeenCalledTimes(1) })

    cleanup()
    const edit = mount([row('openai', 'llm-pi-ai', ['providers', 'openai'], true)], [pi])
    fireEvent.click(screen.getByRole('button', { name: 'Edit openai' }))
    await completeSignIn(screen.getByRole('listitem'))
    await waitFor(() => { expect(edit.load).toHaveBeenCalledTimes(1) })

    cleanup()
    const add = mount([row('anthropic', 'llm-pi-ai', ['providers', 'anthropic'], false)], [pi])
    fireEvent.click(screen.getByRole('button', { name: en.add }))
    await completeSignIn(screen.getByRole('tabpanel'))
    await waitFor(() => { expect(add.load).toHaveBeenCalledTimes(1) })
  })

  it('supports sign-in when the standalone editor has no revision or refresh callback', async () => {
    const pi = namespace('llm-pi-ai', PiConfig, { providers: { openai: { models: [] } } })
    render(
      <ProviderEditor
        provider="openai"
        displayName="openai"
        namespace={pi}
        schema={settingsSchema}
        settingsPath={['providers', 'openai']}
        operations={operations}
        authorization={authorization()}
        t={t}
        readOnly={false}
        onClose={() => {}}
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: en.signIn }))
    await screen.findByText(en.signedIn)
  })
})

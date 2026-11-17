// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Schema from '@deepseek-ai/schemastery'
import type { SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import type { AuthorizationEntryView } from '@deepseek-ai/dsh-api-settings-controller/types'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { ProviderEditor } from '../src/client/ProviderEditor.tsx'
import type { AuthorizationOperations } from '../src/client/authorization-operations.ts'
import type { ModelDiscoveryOutcome, ModelsOperations, SettingsWriteOutcome } from '../src/client/operations.ts'
import { en } from '../src/client/locales.ts'
import { settingsSchema } from './settings-schema.client.ts'

afterEach(cleanup)

const t = (key: keyof typeof en): string => en[key]

const PROVIDER = 'anthropic'
const SETTINGS_PATH = ['providers', PROVIDER]
const KEY_REF = 'ANTHROPIC_API_KEY'
const KEY_LABEL = 'Anthropic API key — uses your API credits'
const PROTOCOLS = ['openai-completions', 'openai-responses', 'anthropic-messages']

const PiAiConfig = Schema.object({
  providers: Schema.dict(Schema.object({
    apiKey: Schema.string().role('secret'),
    apiKeyEnv: Schema.string().role('credential-ref'),
    displayName: Schema.string(),
    api: Schema.union(PROTOCOLS),
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

const ANTHROPIC: AuthorizationEntryView = {
  key: `llm-pi-ai/${PROVIDER}`,
  label: 'Anthropic',
  methods: [
    { id: 'oauth', label: 'Anthropic (Claude Pro/Max)' },
    { id: 'api-key', label: 'Anthropic API key' },
  ],
  inFlight: false,
  configured: false,
}

interface PathOp { op: string; path: string[]; value?: unknown }

interface EditorOptions {
  profile?: Record<string, JsonValue>
  base?: Record<string, JsonValue>
  keyStored?: boolean
  flow?: Partial<AuthorizationEntryView>
  withSignIn?: boolean
}

interface Fakes {
  operations: ModelsOperations
  writeSettings: ReturnType<typeof vi.fn>
  storeCredential: ReturnType<typeof vi.fn>
}

function namespaceWith(profile: Record<string, JsonValue>, base: Record<string, JsonValue>): SettingsNamespaceView {
  return {
    ns: 'llm-pi-ai',
    schema: JSON.parse(JSON.stringify(PiAiConfig.toJSON())) as JsonValue,
    value: { providers: { [PROVIDER]: { ...base, ...profile } } },
    base: { providers: { [PROVIDER]: base } },
    user: { providers: { [PROVIDER]: profile } },
    autoGenerate: true, applies: 'live',
    secrets: [],
    revision: 3,
  }
}

function operationsWith(namespace: SettingsNamespaceView): Fakes {
  const writeSettings = vi.fn((_ns: string, _ops: PathOp[], _revision: number | undefined) =>
    Promise.resolve<SettingsWriteOutcome>({ kind: 'written', view: namespace }))
  const storeCredential = vi.fn((_ref: string, _value: string) => Promise.resolve<string | undefined>(undefined))
  const operations: ModelsOperations = {
    storeCredential,
    removeCredential: () => Promise.resolve<string | undefined>(undefined),
    writeSettings,
    discoverModels: () => Promise.resolve<ModelDiscoveryOutcome>({ kind: 'refused', message: 'not scripted' }),
  }
  return { operations, writeSettings, storeCredential }
}

function authorizationWith(flows: readonly AuthorizationEntryView[]): AuthorizationOperations {
  return {
    list: () => Promise.resolve(flows),
    begin: () => new Promise<never>(() => undefined),
    answer: () => Promise.reject(new Error('answer is not scripted')),
    cancel: () => Promise.resolve(),
  }
}

function renderEditor(options: EditorOptions = {}): Fakes {
  const namespace = namespaceWith(options.profile ?? {}, options.base ?? {})
  const fakes = operationsWith(namespace)
  const authorization = options.withSignIn === false
    ? undefined
    : authorizationWith([{ ...ANTHROPIC, ...options.flow }])
  render(
    <ProviderEditor
      provider={PROVIDER}
      displayName="Anthropic"
      namespace={namespace}
      schema={settingsSchema}
      settingsPath={SETTINGS_PATH}
      credential={{ configured: options.keyStored ?? false, writable: true }}
      operations={fakes.operations}
      {...authorization === undefined ? {} : { authorization }}
      t={t}
      readOnly={false}
      onClose={() => undefined}
    />,
  )
  return fakes
}

function writtenOps(writeSettings: ReturnType<typeof vi.fn>): PathOp[] {
  const call = writeSettings.mock.calls[0] as [string, PathOp[], number | undefined] | undefined
  if (call === undefined) throw new Error('no settings write was recorded')
  return call[1]
}

function buttonNamed(name: string): HTMLButtonElement {
  const found = screen.getByRole('button', { name })
  if (!(found instanceof HTMLButtonElement)) throw new Error(`"${name}" is not a button`)
  return found
}

describe('billing choice on a route with a sign-in and an API key', () => {
  it('offers the sign-in and API credits above one labelled key field', async () => {
    renderEditor()

    expect(await screen.findByRole('group', { name: en.billingLabel })).toBeTruthy()
    expect(screen.getByLabelText(KEY_LABEL)).toBeTruthy()
    expect(screen.getByText(en.billingActiveSignedOut)).toBeTruthy()
  })

  it('reports the subscription when only a sign-in is stored', async () => {
    renderEditor({ flow: { configured: true, kind: 'grant' } })

    expect(await screen.findByText(en.billingActiveSubscription)).toBeTruthy()
    expect(buttonNamed(en.billingSubscription).getAttribute('aria-pressed')).toBe('true')
  })

  it('reports API credits when the saved profile names the key reference', async () => {
    renderEditor({ profile: { apiKeyEnv: KEY_REF }, keyStored: true, flow: { configured: true, kind: 'grant' } })

    expect(await screen.findByText(en.billingActiveApi)).toBeTruthy()
    expect(buttonNamed(en.billingApi).getAttribute('aria-pressed')).toBe('true')
  })

  it('applies the subscription choice by dropping the saved reference', async () => {
    const { writeSettings } = renderEditor({
      profile: { apiKeyEnv: KEY_REF }, keyStored: true, flow: { configured: true, kind: 'grant' },
    })

    fireEvent.click(await screen.findByRole('button', { name: en.billingSubscription }))
    fireEvent.click(screen.getByRole('button', { name: en.apply }))

    await waitFor(() => { expect(writeSettings).toHaveBeenCalled() })
    expect(writtenOps(writeSettings)).toEqual([{ op: 'unset', path: [...SETTINGS_PATH, 'apiKeyEnv'] }])
  })

  it('applies API credits by naming the key reference for a typed key', async () => {
    const { writeSettings, storeCredential } = renderEditor()
    const key = ['fake', 'anthropic', 'key'].join('-')

    await screen.findByRole('group', { name: en.billingLabel })
    fireEvent.change(screen.getByLabelText(KEY_LABEL), { target: { value: key } })
    fireEvent.click(screen.getByRole('button', { name: en.apply }))

    await waitFor(() => { expect(storeCredential).toHaveBeenCalled() })
    expect(storeCredential).toHaveBeenCalledWith(KEY_REF, key)
    expect(writtenOps(writeSettings)).toEqual([{ op: 'set', path: [...SETTINGS_PATH, 'apiKeyEnv'], value: KEY_REF }])
  })

  it('keeps a key stored through the sign-in out of an unrelated save', async () => {
    const { writeSettings } = renderEditor({ flow: { configured: true, kind: 'api-key' } })

    expect(await screen.findByText(en.billingActiveApi)).toBeTruthy()
    fireEvent.change(screen.getByLabelText(en.baseUrl), { target: { value: 'https://anthropic.example.test' } })
    fireEvent.click(screen.getByRole('button', { name: en.apply }))

    await waitFor(() => { expect(writeSettings).toHaveBeenCalled() })
    expect(writtenOps(writeSettings).map(op => op.path.at(-1))).toEqual(['baseURL'])
  })

  it('holds API credits and keeps the subscription off while the sign-in stores an API key', async () => {
    const { writeSettings } = renderEditor({ flow: { configured: true, kind: 'api-key' } })

    expect(await screen.findByText(en.billingActiveApi)).toBeTruthy()
    expect(buttonNamed(en.billingApi).getAttribute('aria-pressed')).toBe('true')
    expect(buttonNamed(en.billingSubscription).disabled).toBe(true)
    expect(screen.getByText(en.billingSubscriptionUnavailable)).toBeTruthy()
    fireEvent.click(buttonNamed(en.billingSubscription))
    expect(screen.getByText(en.billingActiveApi)).toBeTruthy()
    fireEvent.change(screen.getByLabelText(en.baseUrl), { target: { value: 'https://anthropic.example.test' } })
    fireEvent.click(screen.getByRole('button', { name: en.apply }))

    await waitFor(() => { expect(writeSettings).toHaveBeenCalled() })
    expect(writtenOps(writeSettings).map(op => op.op)).not.toContain('unset')
  })

  it('locks the choice when the composition already names the key reference', async () => {
    renderEditor({ base: { apiKeyEnv: KEY_REF }, flow: { configured: true, kind: 'grant' } })

    await screen.findByRole('group', { name: en.billingLabel })
    expect(buttonNamed(en.billingApi).disabled).toBe(true)
    expect(buttonNamed(en.billingSubscription).disabled).toBe(true)
  })

  it('keeps the plain key field and no choice when the route has no sign-in', () => {
    renderEditor({ withSignIn: false })

    expect(screen.getByLabelText(en.keyInput)).toBeTruthy()
    expect(screen.queryByRole('group', { name: en.billingLabel })).toBeNull()
  })
})

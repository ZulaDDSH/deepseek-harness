// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import Schema from '@deepseek-ai/schemastery'
import type { SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import type { AuthorizationEntryView } from '@deepseek-ai/dsh-api-settings-controller/types'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { ProviderEditor } from '../src/client/ProviderEditor.tsx'
import type { AuthorizationOperations } from '../src/client/authorization-operations.ts'
import type { ModelsOperations } from '../src/client/operations.ts'
import { en } from '../src/client/locales.ts'
import { settingsSchema } from './settings-schema.client.ts'

afterEach(cleanup)

const t = (key: keyof typeof en, params?: Record<string, string>): string => {
  const template = en[key]
  if (params === undefined) return template
  return Object.entries(params).reduce((copy, [name, value]) => copy.replace(`{${name}}`, value), template)
}

const PROVIDER = 'anthropic'

const PiAiConfig = Schema.object({
  providers: Schema.dict(Schema.object({
    apiKeyEnv: Schema.string().role('credential-ref'),
    displayName: Schema.string(),
  })),
})

function namespaceWith(value: Record<string, JsonValue>): SettingsNamespaceView {
  return {
    ns: 'llm-pi-ai',
    schema: JSON.parse(JSON.stringify(PiAiConfig.toJSON())) as JsonValue,
    value,
    base: value,
    user: value,
    autoGenerate: true,
    applies: 'live',
    secrets: [],
    revision: 3,
  }
}

function operations(): ModelsOperations {
  return {
    storeCredential: () => Promise.resolve<string | undefined>(undefined),
    removeCredential: () => Promise.resolve<string | undefined>(undefined),
    writeSettings: () => Promise.resolve({ kind: 'refused' as const, message: 'not scripted' }),
    discoverModels: () => Promise.resolve({ kind: 'refused' as const, message: 'discovery is not scripted' }),
  }
}

const ANTHROPIC: AuthorizationEntryView = {
  key: `llm-pi-ai/${PROVIDER}`,
  label: 'Anthropic',
  methods: [{ id: 'oauth', label: 'Anthropic (Claude Pro/Max)' }, { id: 'api-key', label: 'Anthropic API key' }],
  inFlight: false,
  configured: true,
}

function renderCard(flow: Partial<AuthorizationEntryView>): void {
  const authorization: AuthorizationOperations = {
    list: () => Promise.resolve([{ ...ANTHROPIC, ...flow }]),
    begin: () => new Promise<never>(() => undefined),
    answer: () => Promise.reject(new Error('answer is not scripted')),
    cancel: () => Promise.resolve(),
  }
  render(
    <ProviderEditor
      provider={PROVIDER}
      displayName="Anthropic"
      namespace={namespaceWith({ providers: { [PROVIDER]: {} } })}
      schema={settingsSchema}
      settingsPath={['providers', PROVIDER]}
      operations={operations()}
      authorization={authorization}
      t={t}
      readOnly={false}
      onClose={() => undefined}
    />,
  )
}

describe('the borrowed-login warning on a provider card', () => {
  const warning = t('borrowedWarning', { app: 'Claude Code', provider: 'Anthropic' })

  it('warns about a stored borrowed login and moves the human to the API-key field', async () => {
    renderCard({ kind: 'grant', borrowedFrom: 'Claude Code' })

    expect(await screen.findByText(warning)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.borrowedUseApiKey }))
    await waitFor(() => {
      expect(document.activeElement).toBe(document.querySelector('input[type="password"]'))
    })
  })

  it('does not warn when the stored credential is an API key', async () => {
    renderCard({ kind: 'api-key', borrowedFrom: 'Claude Code' })

    expect(await screen.findByRole('button', { name: en.signIn })).toBeTruthy()
    expect(screen.queryByText(warning)).toBeNull()
  })
})

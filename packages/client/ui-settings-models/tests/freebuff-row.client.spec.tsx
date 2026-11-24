// @vitest-environment jsdom (must stay the first line)
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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

const t: ModelsSectionInjected['t'] = (key, params) => Object.entries(params ?? {})
  .reduce((copy, [name, value]) => copy.replace(`{${name}}`, value), en[key])

const FreebuffConfig = Schema.object({ displayName: Schema.string() })
const FLOW: AuthorizationEntryView = {
  key: 'llm-freebuff/freebuff',
  label: 'Freebuff',
  methods: [{ id: 'cli', label: 'Sign in with Freebuff' }],
  inFlight: false,
  configured: false,
}
const URL_NOTICE = { type: 'notice', attempt: 'a1', message: 'Open the link to sign in', url: 'https://freebuff.example/login' } as const

const freebuffNs: SettingsNamespaceView = {
  ns: 'llm-freebuff',
  autoGenerate: true,
  schema: JSON.parse(JSON.stringify(FreebuffConfig.toJSON())) as JsonValue,
  value: {},
  base: {},
  user: {},
  applies: 'live',
  secrets: [],
  revision: 0,
}

const freebuffRow: ProviderRow = {
  entry: { provider: 'freebuff', displayName: 'Freebuff', settingsNs: 'llm-freebuff', settingsPath: [], active: false },
  configured: true,
  removable: false,
  apiKeyEnv: undefined,
  credential: undefined,
}

const operations: ModelsOperations = {
  storeCredential: () => Promise.resolve(undefined),
  removeCredential: () => Promise.resolve(undefined),
  writeSettings: () => Promise.resolve({ kind: 'refused', message: 'not scripted' }),
  discoverModels: () => Promise.resolve({ kind: 'refused', message: 'discovery is not scripted' }),
}

function mount(flow: AuthorizationEntryView): void {
  const authorization: AuthorizationOperations = {
    list: () => Promise.resolve([flow]),
    begin: (_key, _method, onItem) => {
      onItem(URL_NOTICE)
      return new Promise<never>(() => undefined)
    },
    answer: () => Promise.reject(new Error('answer is not scripted')),
    cancel: () => Promise.resolve(),
  }
  const ctx = new Context()
  const controller = new ModelsSettingsStore(ctx, settingsSchema, new SettingsDescribeMirror(ctx))
  controller.store.update((state) => {
    state.status = 'ready'
    state.writable = true
    state.rows = [freebuffRow]
    state.namespaces = new Map([[freebuffNs.ns, freebuffNs]])
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

describe('the llm-freebuff row sign-in card', () => {
  it('shows the sign-in card, surfaces the notified URL, and has no Edit button', async () => {
    mount(FLOW)
    expect(await screen.findByText(en.signedOut)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Edit/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.signIn }))
    const link = await screen.findByRole('link', { name: en.signInOpenPage })
    expect(link.getAttribute('href')).toBe(URL_NOTICE.url)
    expect(screen.getByText(URL_NOTICE.message)).toBeTruthy()
  })

  it('shows signed in for a grant record', async () => {
    mount({ ...FLOW, configured: true, kind: 'grant' })
    expect(await screen.findByText(en.signedIn)).toBeTruthy()
    expect(screen.getByText(en.signedInDescription)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Edit/ })).toBeNull()
  })
})

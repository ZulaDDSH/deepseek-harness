import { describe, expect, it, vi } from 'vitest'
import type { SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { SettingsDescribeMirror } from '@deepseek-ai/dsh-client-ui-settings/src/client/settings-mirror.ts'
import { createModelsOperations } from '../src/client/operations.ts'
import { ModelsSettingsStore } from '../src/client/store.ts'
import { settingsSchema } from './settings-schema.client.ts'

function namespace(value: JsonValue, revision: number): SettingsNamespaceView {
  return {
    ns: 'llm-pi-ai',
    schema: {},
    value,
    base: {},
    user: value,
    autoGenerate: true,
    applies: 'live',
    secrets: [],
    revision,
  }
}

describe('Models settings operations', () => {
  it('updates the shared settings mirror from a successful write answer', async () => {
    const previous = namespace({ providers: { openai: { models: [{ id: 'vision-model', inputModalities: ['text'] }] } } }, 1)
    const updated = namespace({ providers: { openai: { models: [{ id: 'vision-model', inputModalities: ['image'] }] } } }, 2)
    const describe = vi.fn(async () => ({
      ok: true as const,
      value: { writable: true, hasDocument: true, namespaces: [previous] },
    }))
    const mutate = vi.fn(async () => ({ ok: true as const, value: updated }))
    const ctx = { remote: {
      settings: { describe, mutate },
      llm: {
        listProviders: async () => ({ ok: true as const, value: [] }),
        listConfigurableProviders: async () => ({ ok: true as const, value: [] }),
      },
    } } as never
    const mirror = new SettingsDescribeMirror(ctx)
    const controller = new ModelsSettingsStore(ctx, settingsSchema, mirror)
    await controller.load()
    expect(controller.store.getSnapshot().namespaces.get('llm-pi-ai')).toEqual(previous)

    const operations = createModelsOperations(ctx, mirror)
    const outcome = await operations.writeSettings('llm-pi-ai', [], 1)

    expect(outcome).toEqual({ kind: 'written', view: updated })
    expect(mirror.getSnapshot().view?.namespaces).toEqual([updated])
    await controller.load()

    expect(controller.store.getSnapshot().namespaces.get('llm-pi-ai')).toEqual(updated)
    expect(describe).toHaveBeenCalledTimes(1)
  })
})

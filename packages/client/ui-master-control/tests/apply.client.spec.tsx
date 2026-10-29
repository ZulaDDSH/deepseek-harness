// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject, NS, PANEL_ID } from '../src/client/index.ts'
import { MasterControlCenter } from '../src/client/MasterControlCenter.tsx'
import { MasterControlIcon } from '../src/client/MasterControlIcon.tsx'
import { apply as hostApply } from '../src/index.ts'

usePinnedBrowserLanguages('zh-CN')
afterEach(cleanup)

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  type CancelResult =
    | { ok: true; value: undefined }
    | { ok: false; error: { code: string; message: string } }
  const cancel = vi.fn(async (): Promise<CancelResult> => ({ ok: true, value: undefined }))
  type CancelReference = { binding: { session: { cancel: typeof cancel } } }
  const using = vi.fn(async (_id: string, _source: unknown, run: (reference: CancelReference) => Promise<void>) => {
    await run({ binding: { session: { cancel } } })
  })
  const openSession = vi.fn()
  const create = vi.fn(async () => 'new-master')
  const release = vi.fn()
  const reference = { sessionId: 'new-master', release, ready: Promise.resolve({}) }
  const retain = vi.fn(() => reference)
  const sessionsList = {
    getSnapshot: () => ({
      ids: [] as string[],
      byId: {} as Record<string, { projectionValues?: { agentPreset?: string } }>,
    }),
  }
  const workspacesList = {
    getSnapshot: () => ({ items: [{ workspaceId: 'w1' }] }),
  }
  ctx.provide('sessions', { using, masterHome: create, create, retain, list: sessionsList } as never)
  ctx.provide('uiWorkspace', { openSession } as never)
  ctx.provide('workspaces', { list: workspacesList } as never)
  return { ctx, slots: ctx.get('slots') as SlotRegistry, cancel, using, openSession, create, retain, release, reference, sessionsList, workspacesList }
}

function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: {
      main: { kind: 'keyed', scope: 'root' },
      'sidebar.panellist': { kind: 'list', scope: 'root' },
    },
  } as never, () => null)
}

describe('ui-master-control apply', () => {
  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('declares the services the page and interrupt path use', () => {
    expect(inject).toEqual(['slots', 'locale', 'sessions', 'uiWorkspace', 'workspaces'])
  })

  it('registers the sidebar entry above Plugins and injects open/interrupt/openMasterChat', async () => {
    const b = await bench()
    declare(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    const entry = b.slots.entries('main')[0]!
    expect(entry.component).toBe(MasterControlCenter)
    expect(entry.children ?? {}).not.toHaveProperty(['main.conversation'])
    expect(entry.options).toMatchObject({ key: PANEL_ID })
    expect(entry.locale).toBe(NS)

    const icon = b.slots.entries('sidebar.panellist')[0]!
    expect(icon.component).toBe(MasterControlIcon)
    expect(icon.options).toMatchObject({ id: PANEL_ID, order: -10 })
    expect(resolveSlotLabel(icon.options.label)).toBe('总控')
    const unread = () => { throw new Error('The sidebar icon must not read application state') }
    const glyph = render(<MasterControlIcon size={18} active={false}
      usePanelInfo={unread} useSessions={unread} useSessionStatus={unread} useSessionRetainInfo={unread}
      useWorkspaces={unread} useResource={unread} />)
    expect(glyph.container.querySelector('svg')?.getAttribute('width')).toBe('18')

    const face = (entry.inject as unknown as () => {
      open: (id: string) => void
      interrupt: (id: string) => Promise<void>
      openMasterChat: () => Promise<void>
    })()
    face.open('s1')
    expect(b.openSession).toHaveBeenCalledWith('s1')
    await face.interrupt('s1')
    expect(b.using).toHaveBeenCalledWith('s1', { source: 'masterControl' }, expect.any(Function))
    expect(b.cancel).toHaveBeenCalledOnce()

    b.cancel.mockResolvedValueOnce({ ok: false, error: { code: 'busy', message: 'still running' } })
    await expect(face.interrupt('s2')).rejects.toThrow('masterControl.interrupt failed: busy: still running')

    b.openSession.mockClear()
    await face.openMasterChat()
    expect(b.create).toHaveBeenCalledWith()
    expect(b.openSession).toHaveBeenCalledWith('new-master')
    expect(b.retain).not.toHaveBeenCalled()

    await fiber.dispose()
    expect(b.slots.entries('main')).toHaveLength(0)
    expect(b.slots.entries('sidebar.panellist')).toHaveLength(0)
  })

})

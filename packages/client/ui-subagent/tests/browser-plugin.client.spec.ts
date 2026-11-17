/** ui-subagent browser half: catalog actions and read-only composer routing. */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { Context } from '@deepseek-ai/cordis'
import { stubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import { describe, expect, it, vi } from 'vitest'
import type {
  SessionListState, SessionSnapshot, SessionSummary,
} from '@deepseek-ai/dsh-api-session-controller/client'
import type { SubagentAddress } from '@deepseek-ai/dsh-subagent/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ComposerChainProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { apply as applyLocale, inject as localeInject } from '@deepseek-ai/dsh-client-locale/client'
import { SettingsDirectory } from '@deepseek-ai/dsh-client-ui-settings/src/client/settings-directory.ts'
import {
  SubagentHeaderLineage, type SubagentCatalogInjected,
} from '../src/client/SubagentHeaderLineage.tsx'
import {
  SubagentReadOnlyComposer, type SubagentReadOnlyMatch,
} from '../src/client/SubagentReadOnlyComposer.tsx'
import type { SubagentSetupViewInjected } from '../src/client/subagent-setup/SubagentSetupView.tsx'
import type { GlobalSetupSection } from '../src/client/subagent-setup/global-setup.ts'
import { apply, inject } from '../src/client/index.ts'

function summary(partial: Partial<SessionSummary> & { id: SessionId }): SessionSummary {
  return {
    displayTitle: partial.id,
    running: false,
    retainedBy: {},
    updatedAt: 0,
    ...partial,
  } as SessionSummary
}

const sid = (id: string) => id as SessionId

/** Fake root sessions face for catalog actions. */
function sessionsWith(sessions: SessionSummary[]) {
  const byId: Record<string, SessionSummary> = {}
  for (const s of sessions) byId[s.id] = s
  const snapshot: SessionListState = { ids: sessions.map(s => s.id), byId, phase: 'ready', projectionsBySession: {} }
  const actionCalls: { method: string; args: unknown[] }[] = []
  const address: SubagentAddress = {
    parentSessionId: sid('parent'),
    childSessionId: sid('c1'),
    mode: 'continuable',
  }
  return {
    list: {
      getSnapshot: () => snapshot,
      subscribe: () => () => {},
    },
    actionCalls,
    subagentAddress: (childSessionId: SessionId) => childSessionId === address.childSessionId
      ? address
      : undefined,
    refreshProjections: (parentSessionId: SessionId) => {
      actionCalls.push({ method: 'refreshProjections', args: [parentSessionId] })
      return Promise.resolve()
    },
  }
}

async function provideSlotFaces(ctx: Context): Promise<void> {
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({
    name: 'root',
    children: {
      'conversation.session.header.lineage': { kind: 'single', scope: 'session' },
      'conversation.session.header.actions': { kind: 'list', scope: 'session' },
      'conversation.composer': { kind: 'chain', scope: 'session' },
      'conversation.view': { kind: 'list', scope: 'session' },
      'settings.section': { kind: 'list', scope: 'root' },
      'plugins.item': { kind: 'list', scope: 'root' },
    },
  } as never, () => null)
}

/** Boot the plugin over fake sessions and slot faces. */
async function fullBench(sessions: SessionSummary[]) {
  const ctx = new Context()
  const face = sessionsWith(sessions)
  ctx.provide('sessions', face)
  ctx.provide('uiWorkspace', {
    openSession: (address: SubagentAddress) => {
      face.actionCalls.push({ method: 'openSession', args: [address] })
    },
  } as never)
  ctx.provide('sidebarRight', {
    openResource: (address: string, options: unknown) => {
      face.actionCalls.push({ method: 'openResource', args: [address, options] })
    },
  } as never)
  ctx.provide('remote', { $on: () => () => {} } as never)
  ctx.reflect.provide('remote.session', {})
  const served: { namespaces: readonly string[]; register: (served: ReadonlySet<string>) => () => void }[] = []
  const whileServed = vi.fn((namespaces: readonly string[], register: (served: ReadonlySet<string>) => () => void) => {
    served.push({ namespaces, register })
    return () => {}
  })
  const globalForm = stubConfigForm<GlobalSetupSection>()
  ctx.provide('configForms', { developerTools: { enabled: createSnapshotStore(true) }, get: () => globalForm.scope, whileServed } as never)
  new SettingsDirectory(ctx)
  await provideSlotFaces(ctx)
  await ctx.plugin({ inject: localeInject, apply: applyLocale }).await()
  await ctx.plugin({ inject: [...inject], apply }).await()
  return { face, ctx, served, globalForm }
}

const FAMILY: SessionSummary[] = [
  summary({ id: sid('parent'), displayTitle: 'parent', running: true }),
  summary({ id: sid('c1'), parentId: sid('parent'), displayTitle: 'worker-1', running: true }),
  summary({ id: sid('c2'), parentId: sid('parent'), displayTitle: 'worker-2', running: true }),
  // Filtered out: not running / other parent / label miss.
  summary({ id: sid('c3'), parentId: sid('parent'), displayTitle: 'worker-3', running: false }),
  summary({ id: sid('c4'), parentId: sid('other'), displayTitle: 'worker-4', running: true }),
  summary({ id: sid('c5'), parentId: sid('parent'), displayTitle: 'scout', running: true }),
]

describe('apply', () => {
  it('declares the services it binds', () => {
    expect(inject).toEqual(['sessions', 'uiWorkspace', 'slots', 'locale', 'sidebarRight', 'remote', 'remote.session', 'configForms', 'settingsDirectory'])
  })

  it('registers the Subagent Setup View tab after Trajectory', async () => {
    const { ctx } = await fullBench(FAMILY)
    const setupEntry = ctx.slots.entries('conversation.view').find(entry => entry.options.id === 'subagent-setup')!
    expect(setupEntry.options.order).toBe(20)
    expect(setupEntry.options.label).toBeTypeOf('function')
  })

  it('puts the global Orchestrator & Subagents page in Settings only while the Host serves session-controller, and no longer on the Plugins page', async () => {
    const { ctx, served, globalForm } = await fullBench(FAMILY)
    expect(ctx.slots.entries('settings.section')).toEqual([])
    const registration = served.find(entry => entry.namespaces.includes('session-controller'))!
    const dispose = registration.register(new Set(['session-controller']))
    const entry = ctx.slots.entries('settings.section').find(candidate => candidate.options.id === 'subagent-setup')!
    expect(entry.options.label).toBeTypeOf('function')
    expect(ctx.slots.entries('plugins.item')).toEqual([])
    const injected = (entry.inject! as () => Pick<SubagentSetupViewInjected, 'hooks' | 'mode' | 'saveGlobal'>)()
    expect(injected.mode).toBe('global')
    expect(ctx.settingsDirectory.search('defaults').map(item => item.id)).toContain('subagent-setup.defaults')
    expect(ctx.settingsDirectory.search('coder').map(item => item.id)).toContain('subagent-setup.roles')
    expect(ctx.settingsDirectory.search('GSD').map(item => item.id)).toContain('subagent-setup.gsd')
    expect(ctx.settingsDirectory.search('orchestrator').every(item => item.section === 'subagent-setup')).toBe(true)

    const setup = { enabled: true, reviewRounds: 1, roles: { coder: { mode: 'jev' as const } } }
    await expect(injected.saveGlobal(setup)).resolves.toBeUndefined()
    expect(globalForm.mutate).toHaveBeenCalledWith([{ op: 'set', path: ['subagentSetup'], value: setup }], undefined)
    globalForm.publish({ value: { subagentSetup: setup }, revision: 2 })
    expect(injected.hooks.globalSetup.getSnapshot()).toEqual(setup)

    dispose()
    expect(ctx.slots.entries('settings.section')).toEqual([])
    expect(ctx.settingsDirectory.search('defaults')).toEqual([])
  })

  it('follows the Claude Code settings namespace to learn whether the Claude CLI backend exists', async () => {
    const { served } = await fullBench(FAMILY)
    expect(served.some(entry => entry.namespaces.includes('subagent-claude-code'))).toBe(true)
  })

  it('registers catalog actions and selects read-only subagent composers from session facts', async () => {
    const { ctx, face } = await fullBench(FAMILY)
    const catalogEntry = ctx.slots.entries('conversation.session.header.lineage')
      .find(entry => entry.component === SubagentHeaderLineage)!
    const actions = (catalogEntry.inject as unknown as (id: SessionId) => SubagentCatalogInjected)(sid('parent'))
    const address: SubagentAddress = {
      parentSessionId: sid('parent'),
      childSessionId: sid('c1'),
      mode: 'continuable',
    }
    actions.openChild(address)
    actions.openChildAside(address)
    actions.refreshProjection(sid('parent'))
    expect(face.actionCalls).toEqual([
      { method: 'openSession', args: [address] },
      {
        method: 'openResource',
        args: [
          'dsh-resource://subagentchat/session/c1?parent=parent&mode=continuable',
          { kind: 'subagentchat', preferNewPane: true },
        ],
      },
      { method: 'refreshProjections', args: [sid('parent')] },
    ])

    // The root-session catalog seat registers in the actions band with the
    // same business face, between the preset label (-10) and background
    // tasks (20).
    const actionEntry = ctx.slots.entries('conversation.session.header.actions')
      .find(entry => entry.options.id === 'subagent-catalog')!
    expect(actionEntry.options.order).toBe(10)
    expect(actionEntry.inject).toBe(catalogEntry.inject)

    const composerEntry = ctx.slots.entries('conversation.composer')
      .find(entry => entry.component === SubagentReadOnlyComposer)!
    const select = composerEntry.select as (owner: ComposerChainProps) => SubagentReadOnlyMatch | null
    const owner = (
      subagent: SessionSnapshot['subagent'] | undefined,
      running = false,
    ): ComposerChainProps => ({
      sessionId: subagent?.address.childSessionId,
      session: subagent === undefined
        ? undefined
        : ({ subagent, running } as SessionSnapshot),
      pendingInteraction: undefined,
    })
    expect(select(owner(undefined))).toBeNull()
    expect(select(owner(null))).toBeNull()
    expect(select(owner({ address: { ...address, mode: 'one-shot' }, parentAvailable: true })))
      .toEqual({ reason: 'one-shot' })
    // A RUNNING one-shot yields the default composer, which carries steer, queue and Stop.
    expect(select(owner({ address: { ...address, mode: 'one-shot' }, parentAvailable: true }, true))).toBeNull()
    expect(select(owner({ address: { ...address, mode: 'unknown' }, parentAvailable: true })))
      .toEqual({ reason: 'unknown' })
    expect(select(owner({ address }))).toBeNull()
    expect(select(owner({ address, parentAvailable: true }))).toBeNull()
    expect(select(owner({ address, parentAvailable: false })))
      .toEqual({ reason: 'parent-unavailable' })
    // A RUNNING parent-offline continuable yields the default composer, whose
    // disabled input still carries the primary Stop; stopped, it takes back over.
    expect(select(owner({ address, parentAvailable: false }, true))).toBeNull()
  })
})

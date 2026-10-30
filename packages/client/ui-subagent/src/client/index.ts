/** Web subagent catalog, navigation, and addressed-session composer owner. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SubagentAddress } from '@deepseek-ai/dsh-subagent/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ComposerChainProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { SubagentCatalogAction, SubagentHeaderLineage, type SubagentCatalogInjected } from './SubagentHeaderLineage.tsx'
import {
  SubagentReadOnlyComposer, type SubagentReadOnlyMatch,
} from './SubagentReadOnlyComposer.tsx'
import {
  SubagentSetupView, type SetupSource, type SubagentSetupViewInjected,
} from './subagent-setup/SubagentSetupView.tsx'
import {
  CLAUDE_CODE_NS, GLOBAL_SETUP_NS, createClaudeServedFlag, globalSetupSource, writeGlobalSetup, type GlobalSetupSection,
} from './subagent-setup/global-setup.ts'
import { registerSidebarChat, subagentChatAddress } from './sidebar-chat/index.tsx'
import type { SubagentSetup } from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { subagentSearchEntries } from './subagent-setup/search-entries.ts'
import { en, ja, es, fr, de, ru, pt, NS, zh, type SubagentKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Subagent catalog and read-only composer copy. */
    'subagent': SubagentKey
  }
}

export type {
  SubagentCatalogActionProps, SubagentCatalogInjected, SubagentHeaderLineageProps,
} from './SubagentHeaderLineage.tsx'
export type {
  SubagentReadOnlyComposerProps, SubagentReadOnlyMatch,
} from './SubagentReadOnlyComposer.tsx'

/** Required services for subagent presentation and navigation. */
export const inject = ['sessions', 'uiWorkspace', 'slots', 'locale', 'sidebarRight', 'remote', 'remote.session', 'configForms', 'settingsDirectory']

const NO_SOURCE: SetupSource<unknown> = { getSnapshot: () => undefined, subscribe: () => () => {} }

/** Claim the composer for one-shot history or an unavailable continuation owner. */
function selectReadOnlySubagent(owner: ComposerChainProps): SubagentReadOnlyMatch | null {
  const subagent = owner.session?.subagent
  if (subagent === undefined || subagent === null) return null
  if (subagent.address.mode === 'unknown') return { reason: 'unknown' }
  if (subagent.address.mode === 'one-shot' && owner.session?.running !== true) return { reason: 'one-shot' }
  // Until a Host summary establishes parent availability, keep the normal
  // disabled composer instead of claiming that the parent is offline.
  if (subagent.parentAvailable !== false) return null
  // A RUNNING parent-offline continuable child keeps the default composer:
  // its input is disabled there, but the same primary Stop stays available so
  // the child can be interrupted. Once it stops, this takeover returns.
  return owner.session?.running === true ? null : { reason: 'parent-unavailable' }
}

/**
 * Client plugin body: register the subagent catalog and read-only composer seats.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ja, es, fr, de, ru, pt }), 'ui-subagent: dictionaries')
  const t = ctx.locale.bind(NS)
  ctx.inject(['resources', 'sidebarRightTabs'], (scope) => {
    registerSidebarChat(scope, ctx.locale.bind(NS))
  })
  const catalogActions = (_parentSessionId: SessionId): SubagentCatalogInjected => ({
    openChild(address: SubagentAddress) {
      ctx.uiWorkspace.openSession(address)
    },
    openChildAside(address: SubagentAddress) {
      ctx.sidebarRight.openResource(subagentChatAddress(address), {
        kind: 'subagentchat',
        preferNewPane: true,
      })
    },
    refreshProjection(parentSessionId: SessionId) {
      void ctx.sessions.refreshProjections(parentSessionId)
    },
  })
  ctx.slots.inject(
    'conversation.session.header.lineage',
    () => ctx.slots.register({
      name: 'conversation.session.header.lineage',
      locale: NS,
      inject: catalogActions,
    }, SubagentHeaderLineage),
  )
  ctx.slots.inject(
    'conversation.session.header.actions',
    () => ctx.slots.register({
      name: 'conversation.session.header.actions',
      id: 'subagent-catalog',
      // Between the preset label (-10) and background tasks (20), after Team
      // navigation (-20).
      order: 10,
      locale: NS,
      inject: catalogActions,
    }, SubagentCatalogAction),
  )
  ctx.slots.inject(
    'conversation.composer',
    () => ctx.slots.register({
      name: 'conversation.composer',
      priority: -10,
      locale: NS,
      select: selectReadOnlySubagent,
    }, SubagentReadOnlyComposer),
  )
  const globalScope = ctx.configForms.get<GlobalSetupSection>(GLOBAL_SETUP_NS)
  const claudeServed = createClaudeServedFlag()
  ctx.effect(() => ctx.configForms.whileServed([CLAUDE_CODE_NS], () => {
    claudeServed.set(true)
    return () => { claudeServed.set(false) }
  }), 'ui-subagent: Claude Code availability')
  const loadCatalog = async () => {
    const response = await ctx.remote.session.modelCatalog()
    return response.ok ? response.value : undefined
  }
  const saveGlobal = async (setup: SubagentSetup): Promise<string | undefined> => (
    await writeGlobalSetup(globalScope, setup) ? undefined : t('global.saveError')
  )
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'subagent-setup',
    order: 20,
    locale: NS,
    label: () => t('setup.tab'),
    inject: (sessionId: SessionId): SubagentSetupViewInjected => {
      const binding = ctx.sessions.binding(sessionId)
      if (binding === undefined) throw new Error(`ui-subagent: session "${sessionId}" is unavailable`)
      return {
        hooks: {
          runOptions: binding.session.projections.faceOf('runOptions'),
          claudeCode: binding.session.projections.faceOf('claudeCodeRunOptions'),
          globalSetup: globalSetupSource(globalScope),
        },
        mode: 'session',
        child: ctx.sessions.subagentAddress(sessionId) !== undefined,
        loadCatalog,
        saveRunOptions: async (options) => {
          const response = await ctx.remote.session.setRunOptions({ sessionId, ...options })
          return response.ok ? undefined : response.error.message
        },
        saveGlobal,
      }
    },
  }, SubagentSetupView))
  ctx.effect(() => ctx.configForms.whileServed([GLOBAL_SETUP_NS], () => {
    const disposeSection = ctx.slots.inject('settings.section', () => ctx.slots.register({
      name: 'settings.section',
      id: 'subagent-setup',
      order: 21,
      label: () => t('global.title'),
      locale: NS,
      inject: (): SubagentSetupViewInjected => ({
        hooks: { runOptions: NO_SOURCE, claudeCode: claudeServed, globalSetup: globalSetupSource(globalScope) },
        mode: 'global',
        child: false,
        loadCatalog,
        saveRunOptions: () => Promise.resolve(undefined),
        saveGlobal,
      }),
    }, SubagentSetupView))
    const disposeSearch = ctx.settingsDirectory.register(subagentSearchEntries(t))
    return () => {
      disposeSearch()
      disposeSection()
    }
  }), 'ui-subagent: global defaults section')
}

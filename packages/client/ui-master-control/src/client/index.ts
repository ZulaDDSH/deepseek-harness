import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { UiWorkspace } from '@deepseek-ai/dsh-client-ui-workspace/client'
import { MasterControlIcon } from './MasterControlIcon.tsx'
import { MasterControlPage, type MasterControlInjected } from './MasterControlPage.tsx'
import { en, zh, type MasterControlKey } from './locales.ts'

export type { MasterControlInjected, MasterControlPageProps } from './MasterControlPage.tsx'
export type { MasterRow, RowState } from './rows.ts'
export type { MasterControlKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    masterControl: MasterControlKey
  }
}

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    masterControl: unknown
  }
}

export const NS = 'masterControl'

export const PANEL_ID = 'master-control' as MainPanelId

export const inject = ['slots', 'locale', 'sessions', 'uiWorkspace', 'workspaces']

export async function openMasterChat(sessions: ISessions, uiWorkspace: UiWorkspace): Promise<void> {
  uiWorkspace.openSession(await sessions.masterHome())
}

export function apply(ctx: ClientContext): void {
  const sessions = ctx.get('sessions') as ISessions
  const uiWorkspace = ctx.get('uiWorkspace') as UiWorkspace
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-master-control: dictionaries')
  const t = ctx.locale.bind(NS)
  const injected = (): MasterControlInjected => ({
    open: (id) => { uiWorkspace.openSession(id as SessionId) },
    interrupt: async (id) => {
      await sessions.using(id as SessionId, { source: 'masterControl' }, async (reference) => {
        const result = await reference.binding.session.cancel()
        if (!result.ok) throw new Error(`masterControl.interrupt failed: ${result.error.code}: ${result.error.message}`)
      })
    },
    openMasterChat: () => openMasterChat(sessions, uiWorkspace),
    discover: () => sessions.externalChats(),
    importChats: keys => sessions.importChats(keys),
  })
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: PANEL_ID,
    locale: NS,
    inject: injected,
  }, MasterControlPage))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: -10,
    label: () => t('panel'),
    locale: NS,
  }, MasterControlIcon))
}

/** Browser registrations for the memory workspace. */
import type { Context } from '@deepseek-ai/cordis'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { MemoryPage, MemoryIcon } from './MemoryPage.tsx'
import { en, zh, NS, type MemoryWorkspaceKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { memoryWorkspace: MemoryWorkspaceKey }
}

export const inject = ['slots', 'locale', 'remote', 'remote.memoryWorkspace', 'layout']

/**
 * Register a discoverable sidebar entry and the main memory workspace.
 * @param ctx - browser plugin effect owner.
 */
export function apply(ctx: Context): void {
  const panel = 'memory' as MainPanelId
  ctx.effect(() => ctx.locale.register(NS, { en, zh }))
  const t = ctx.locale.bind(NS)
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main', key: panel, locale: NS,
    inject: () => ({ memory: ctx.remote.memoryWorkspace }),
  }, MemoryPage))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist', id: panel, order: 1, label: () => t('panel'), locale: NS,
  }, MemoryIcon))
}

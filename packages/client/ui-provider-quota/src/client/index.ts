/** Session-header provider quota usage contribution. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { ProviderQuotaController } from './controller.ts'
import { ProviderQuotaAction, type ProviderQuotaActionInjected } from './ProviderQuotaAction.tsx'
import { en, NS, zh, type ProviderQuotaKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'provider-quota': ProviderQuotaKey }
}

export const inject = ['locale', 'remote', 'remote.quota', 'slots']

export function apply(ctx: ClientContext): void {
  const controller = new ProviderQuotaController(ctx.remote)
  void controller.load()
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'provider-quota: dictionaries')
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities', id: 'provider-quota', order: -5, locale: NS,
    inject: (): ProviderQuotaActionInjected => ({
      hooks: { providers: controller.providers, state: controller.state },
      refresh: () => controller.refresh(),
    }),
  }, ProviderQuotaAction))
}

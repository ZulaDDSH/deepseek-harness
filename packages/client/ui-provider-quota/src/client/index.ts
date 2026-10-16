/** Session-header provider quota usage contribution, the composer-dock usage prompt, and its Plugins settings page. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { ProviderQuotaController } from './controller.ts'
import { ProviderQuotaAction, type ProviderQuotaActionInjected } from './ProviderQuotaAction.tsx'
import { UsageLimitCard } from './UsageLimitCard.tsx'
import { UsageSwitchPrompt, type UsageSwitchPromptInjected } from './UsageSwitchPrompt.tsx'
import { en, NS, zh, type ProviderQuotaKey } from './locales.ts'
import { QUOTA_NS, UsageLimitCardController } from './usage-limit-card-controller.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'provider-quota': ProviderQuotaKey }
}

export const inject = ['locale', 'remote', 'remote.quota', 'remote.settings', 'configForms', 'slots']

export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  const controller = new ProviderQuotaController(ctx.remote)
  const usageLimit = new UsageLimitCardController(ctx.configForms.get(QUOTA_NS))
  void controller.load()
  ctx.effect(() => () => { usageLimit.dispose() }, 'provider-quota: usage limit form subscription')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'provider-quota: dictionaries')
  ctx.effect(() => ctx.configForms.whileServed([QUOTA_NS], () => ctx.slots.inject('plugins.item', () => ctx.slots.register({
    name: 'plugins.item', id: 'provider-quota', order: 50, label: () => t('usageSettingsTitle'), locale: NS, inject: () => usageLimit.inject(),
  }, UsageLimitCard))), 'provider-quota: usage settings page')
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities', id: 'provider-quota', order: -5, locale: NS,
    inject: (): ProviderQuotaActionInjected => ({
      hooks: { providers: controller.providers, state: controller.state },
      refresh: () => controller.refresh(),
      switchBilling: (billing, target, providerId, resetAt) => controller.switchBilling(billing, target, providerId, resetAt),
    }),
  }, ProviderQuotaAction))
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock', id: 'usage', order: 5, locale: NS,
    inject: (): UsageSwitchPromptInjected => ({
      hooks: { state: controller.state, dismissed: controller.dismissed, switched: controller.switched, nearLimit: usageLimit.nearLimit },
      dismiss: (key) => { controller.dismiss(key) },
      switchBilling: (billing, target, providerId, resetAt) => controller.switchBilling(billing, target, providerId, resetAt),
      refreshValues: () => controller.refreshValues(),
    }),
  }, UsageSwitchPrompt))
}

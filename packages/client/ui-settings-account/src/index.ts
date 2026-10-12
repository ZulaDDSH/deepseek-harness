/** Host configuration for the account settings client. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-settings'
import { type ContactConfig, ContactConfigFields, CONTACT_CONFIG_GLOBAL } from './contact-config.ts'
import z from '@deepseek-ai/schemastery'
/** Public contact and bonus notice options. */
export type Config = ContactConfig

/** Configuration projected through the account plugin's shared form. */
export const Config = z.object({
  contactFormUrl: ContactConfigFields.contactFormUrl,
  contactSource: ContactConfigFields.contactSource,
  bonusAckRetryDelayMs: ContactConfigFields.bonusAckRetryDelayMs,
  bonusAckRetryMaxDelayMs: ContactConfigFields.bonusAckRetryMaxDelayMs,
})

/**
 * Publish public questionnaire options before browser plugins activate.
 * @param ctx - Host context collecting page initialization data.
 * @param config - validated deployment options.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.inject(['settings'], (scope) => {
    scope.effect(() => scope.settings.configure({ auto: false }, ctx.fiber))
  })
  ctx.on('webserver/index-inject', (table) => {
    table.push({ kind: 'global', name: CONTACT_CONFIG_GLOBAL, value: {
      contactFormUrl: config.contactFormUrl, contactSource: config.contactSource,
      bonusAckRetryDelayMs: config.bonusAckRetryDelayMs, bonusAckRetryMaxDelayMs: config.bonusAckRetryMaxDelayMs,
    } satisfies ContactConfig })
  })
}

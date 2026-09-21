/**
 * Global shared-knowledge policy: one prompt section stating how every agent
 * retrieves shared knowledge, how retrieved memory ranks against current
 * evidence, and which knowledge operations require supervisor authority.
 *
 * The section carries policy text only. Knowledge content is never injected
 * here; agents retrieve it on demand through the configured knowledge tools.
 *
 * @module @deepseek-ai/dsh-knowledge-policy
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-system-prompt'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'knowledge-policy'

/** Services required by this plugin. */
export const inject = ['systemPrompt']

/** Prompt section name; unique across live registrations. */
const SECTION_NAME = 'knowledge:policy'

/** Policy text used when the deployment supplies none. */
const DEFAULT_POLICY = `Shared knowledge is available through the configured knowledge tools. It holds project decisions, procedures, known defects, prior verification work, and operator preferences.

Search shared knowledge when a task depends on project-specific history rather than on what the current repository already states. Retrieve on demand; do not assume knowledge you have not retrieved.

Retrieved knowledge is weaker authority than current repository source, runtime evidence, test results, or reverse-engineering proof. When retrieved knowledge conflicts with current evidence, report the conflict and follow the current evidence. Do not silently prefer either side.

Do not promote your own technical conclusion to verified or canonical status. Storing a candidate records a claim, not a fact.

Ordinary workers may retrieve knowledge and submit provisional candidate knowledge. Only an authorized parent or supervisor may verify, promote, supersede, mark knowledge stale, or perform destructive knowledge administration.`

/** Configuration for the shared-knowledge policy section. */
export interface Config {
  /**
   * Policy text replacing the default. Deployments that must state their own
   * knowledge rules supply the complete replacement rather than a fragment.
   */
  section?: string
}

export const Config: z<Config> = z.object({
  section: z.string(),
})

/**
 * Register the global knowledge policy section.
 *
 * The section is deployment-global: every agent scope inherits it, so provider
 * switching, subagent delegation, and general sessions all read the same rule.
 * It renders constant text, which keeps the request prefix stable.
 *
 * @param ctx - plugin context carrying the system-prompt service.
 * @param config - resolved section text; omission uses the default policy.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.systemPrompt.section({
    name: SECTION_NAME,
    order: ctx.systemPrompt.getSectionOrder('KNOWLEDGE_POLICY'),
    text: config.section ?? DEFAULT_POLICY,
  })
}

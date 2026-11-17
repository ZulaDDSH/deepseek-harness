/**
 * The Anthropic route's API-credits key, carried into one Claude Code run.
 *
 * @module @deepseek-ai/dsh-subagent-claude-code/api-credits
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-settings'
import { credentialKey, credentialRef } from '@deepseek-ai/dsh-credentials'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'

/** Provider id of the Anthropic route, whose API-credits key a Claude Code run may carry. */
export const ANTHROPIC_ROUTE = 'anthropic'
// Must equal llm-pi-ai's RECORD_SCOPE, the scope its sign-in stores the route's record under.
const PI_AI_RECORD_SCOPE = 'llm-pi-ai'

/** The key reference the Anthropic route's profile names, or undefined when it names none. */
function anthropicKeyRef(ctx: Context): string | undefined {
  const settings = ctx.get('settings')
  const route = ctx.get('llm')?.listConfigurableProviders().find(entry => entry.provider === ANTHROPIC_ROUTE)
  if (settings === undefined || route === undefined) return undefined
  let profile: unknown = settings.describe({ redactSecrets: true }).find(ns => ns.ns === route.settingsNs)?.value
  for (const key of route.settingsPath) {
    profile = typeof profile === 'object' && profile !== null ? Reflect.get(profile, key) : undefined
  }
  const ref: unknown = typeof profile === 'object' && profile !== null ? Reflect.get(profile, 'apiKeyEnv') : undefined
  return typeof ref === 'string' && ref.length > 0 ? ref : undefined
}

/** The API key a sign-in stored as the route's record, or undefined when none is stored. */
async function storedSignInKey(ctx: Context): Promise<string | undefined> {
  const record = await ctx.get('credentials')?.readRecord(credentialKey(PI_AI_RECORD_SCOPE, ANTHROPIC_ROUTE))
  return record?.kind === 'api-key' && record.key !== undefined && record.key.length > 0 ? record.key : undefined
}

/**
 * The child environment for one run, with the Anthropic route's API key added when the route has one.
 * @param ctx - context carrying the llm, settings, and credentials services.
 * @param env - the deployment's explicit child environment.
 * @returns the environment the run starts with.
 */
export async function withApiCreditsKey(ctx: Context, env: Record<string, string>): Promise<Record<string, string>> {
  if (env.ANTHROPIC_API_KEY !== undefined) return env
  const ref = anthropicKeyRef(ctx)
  const signIn = ref === undefined ? await storedSignInKey(ctx) : undefined
  if (ref === undefined && signIn === undefined) return env
  const effective = { ...scrubbedParentEnv(), ...env }
  if (effective.ANTHROPIC_BASE_URL !== undefined) {
    ctx.logger.warn('subagent-claude-code: ANTHROPIC_BASE_URL is set, so the Anthropic API key is not sent with this run')
    return env
  }
  const key = ref === undefined ? signIn : (await ctx.get('credentials')?.resolve(credentialRef(ref)))?.value
  if (key === undefined || key.length === 0) {
    throw new Error(`subagent-claude-code: the Anthropic route bills to API credits, but ${ref ?? 'its sign-in key'} resolves to no credential`)
  }
  return { ...env, ANTHROPIC_API_KEY: key }
}

/** Shared projection of the live LLM registry into the browser model catalog. */

import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { credentialRef, isCredentialRefName } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-settings'
import { ultracodeSupported, type LlmModelInfo } from '@deepseek-ai/dsh-llm'
import type { Context } from '@deepseek-ai/cordis'
import type {
  ModelCatalog,
  ModelReasoning,
  ModelSelection,
} from './types.ts'

/**
 * Build the browser model catalog without requiring a Session.
 * @param ctx - Host context carrying the live LLM registry.
 * @param defaultSelection - deployment default used before a Session selects a model.
 * @returns successful non-empty provider groups and isolated provider failures.
 */
export async function buildModelCatalog(
  ctx: Context,
  defaultSelection: ModelSelection = ctx.agentDefaultModel.currentSelection(),
): Promise<ModelCatalog> {
  const providers = ctx.llm.listProviders()
  const missing = await missingCredentialProviders(ctx)
  const catalog = await Promise.all(providers.map(async (provider) => {
    try {
      const models = await ctx.llm.listModels(provider.id)
      const entries = await Promise.all(models.map(async (model) => {
        const resolved = await ctx.llm.resolveModelInfo(provider.id, model.id)
        const reasoning: ModelReasoning | undefined = resolved.reasoning === undefined
          ? undefined
          : {
            efforts: resolved.reasoning.efforts.map(effort => ({
              id: effort.id,
              name: effort.name,
              ...(effort.description === undefined ? {} : { description: effort.description }),
            })),
            ...(resolved.reasoning.defaultEffort === undefined
              ? {}
              : { defaultEffort: resolved.reasoning.defaultEffort }),
          }
        return {
          id: model.id,
          name: model.name,
          ...(model.description === undefined ? {} : { description: model.description }),
          ...(reasoning === undefined ? {} : { reasoning }),
          ...(ultracodeSupported(model.id) ? { ultracode: true } : {}),
          ...(model.badge === undefined ? {} : { badge: model.badge }),
        }
      }))
      return {
        kind: 'group' as const,
        group: {
          id: provider.id,
          name: provider.name,
          models: entries,
          ...missing.includes(provider.id) ? { missingCredential: true } : {},
        },
      }
    } catch (error) {
      return {
        kind: 'failure' as const,
        failure: {
          id: provider.id,
          name: provider.name,
          message: error instanceof Error ? error.message : String(error),
        },
      }
    }
  }))
  const groups = catalog.flatMap(item => item.kind === 'group' ? [item.group] : [])
    .filter(group => group.models.length > 0)
  return {
    default: { ...defaultSelection },
    routableProviders: groups.map(group => group.id),
    groups,
    failures: catalog.flatMap(item => item.kind === 'failure' ? [item.failure] : []),
  }
}

/**
 * Check a GUI selection against the current available provider catalog.
 * @param ctx - Host LLM registry.
 * @param selection - stored or explicitly requested selection.
 * @returns whether the exact model is currently advertised as available.
 */
export async function modelAvailable(ctx: Context, selection: ModelSelection): Promise<boolean> {
  if (!ctx.llm.listProviders().some(provider => provider.id === selection.provider)) return false
  let models: readonly LlmModelInfo[]
  try { models = await ctx.llm.listModels(selection.provider) }
  catch (error) {
    throw new RemoteError('session/model-unavailable',
      error instanceof Error ? error.message : String(error),
      { provider: selection.provider, model: selection.model })
  }
  return models.some(model => model.id === selection.model)
}

/**
 * Read the API-key references each configurable provider names in its settings profile.
 * @param ctx - Host registry and settings.
 * @returns one entry per provider route with a non-empty `apiKeyEnv`, or undefined without settings.
 */
function apiKeyReferencesOf(ctx: Context): readonly { provider: string; ref: string }[] | undefined {
  const settings = ctx.get('settings')
  if (settings === undefined) return undefined
  const namespaces = settings.describe({ redactSecrets: true })
  const references: { provider: string; ref: string }[] = []
  for (const provider of ctx.llm.listConfigurableProviders()) {
    if (provider.provider === 'deepseek-account') continue
    let profile = namespaces.find(namespace => namespace.ns === provider.settingsNs)?.value
    for (const key of provider.settingsPath) {
      profile = typeof profile === 'object' && profile !== null ? Reflect.get(profile, key) : undefined
    }
    if (typeof profile !== 'object' || profile === null) continue
    const ref: unknown = Reflect.get(profile, 'apiKeyEnv')
    if (typeof ref === 'string' && ref.length > 0) references.push({ provider: provider.provider, ref })
  }
  return references
}

/**
 * Check configured provider API-key references independently of model availability.
 * @param ctx - Host registry, settings, and credential services.
 * @returns whether any API-key provider has a configured credential.
 */
export async function hasProviderApiKey(ctx: Context): Promise<boolean> {
  const credentials = ctx.get('credentials')
  const references = credentials === undefined ? undefined : apiKeyReferencesOf(ctx)
  if (credentials === undefined || references === undefined) {
    throw new RemoteError('session/provider-credentials-unavailable', 'provider credentials are unavailable', {})
  }
  for (const { ref } of references) {
    if ((await credentials.describe(credentialRef(ref))).configured) return true
  }
  return false
}

/**
 * Name the provider routes whose named API-key reference has no configured credential.
 * @param ctx - Host registry, settings, and credential services.
 * @returns provider route ids that cannot authenticate; empty when the state cannot be read.
 */
export async function missingCredentialProviders(ctx: Context): Promise<readonly string[]> {
  const credentials = ctx.get('credentials')
  const references = credentials === undefined ? undefined : apiKeyReferencesOf(ctx)
  if (credentials === undefined || references === undefined) return []
  const missing = await Promise.all(references
    .filter(({ ref }) => isCredentialRefName(ref))
    .map(async ({ provider, ref }) => {
      try {
        return (await credentials.describe(credentialRef(ref))).configured ? undefined : provider
      } catch {
        return undefined
      }
    }))
  return missing.filter((provider): provider is string => provider !== undefined)
}

/**
 * Authorization flows for the pi-ai providers that ship a login. This is the
 * whole of the translation between the harness's neutral notice/prompt
 * vocabulary and pi-ai's `AuthInteraction`; nothing above it knows which
 * library ran the conversation.
 *
 * @module dsh-llm-pi-ai/login
 */

import type { AuthEvent, AuthPrompt, AuthType, Provider } from '@earendil-works/pi-ai'
import type { Context } from '@deepseek-ai/cordis'
import type { AuthorizationFlow, AuthorizationMethod, AuthorizationPrompt, AuthorizationSession } from '@deepseek-ai/dsh-authorization'
import { isCredentialKeySegment } from '@deepseek-ai/dsh-credentials'
import { catalogProvider, catalogProviderIds } from './catalog.ts'
import { recordKeyFor } from './auth.ts'
import type { PiAiAuthInjection } from './adapter.ts'
import { createModels } from './models.ts'

/**
 * Catalog providers whose OAuth login borrows another product's app identity,
 * keyed by provider id and valued by the product the sign-in confirmation names.
 */
const BORROWED_APP_LOGINS: ReadonlyMap<string, string> = new Map([
  ['anthropic', 'Claude Code'],
  ['openai-codex', 'Codex'],
  ['github-copilot', 'GitHub Copilot Chat'],
  ['kimi-coding', 'Kimi Code'],
  ['xai', 'Grok CLI'],
])

/**
 * Catalog providers whose OAuth login this adapter does not offer. pi-ai's Sign
 * in with ChatGPT (`openai`) identifies the installation to OpenAI with a
 * stable UUID that the app supplies through `LoginOptions.getDeviceId`, and it
 * refuses to start without one. The harness keeps no installation ID meant for
 * a third-party account sign-in, so the route signs in with an API key.
 */
const UNSERVED_OAUTH: ReadonlySet<string> = new Set(['openai'])

/**
 * The login methods one catalog provider offers.
 *
 * A method appears only when pi-ai can actually run it: `oauth` carries a
 * `login` that runs without app-supplied login options except for the
 * providers in {@link UNSERVED_OAUTH}, while an api-key method has one only
 * when the provider collects its key interactively — which every installed one
 * currently does, so a key is typed into pi-ai's own prompt rather than into
 * the settings form.
 * @param provider - the installed catalog provider, if pi-ai ships one.
 * @returns its methods, most preferred first; empty when it offers no login.
 */
function loginMethods(provider: Provider | undefined): AuthorizationMethod[] {
  const methods: AuthorizationMethod[] = []
  const oauth = provider === undefined || UNSERVED_OAUTH.has(provider.id) ? undefined : provider.auth.oauth
  if (oauth !== undefined) methods.push({ id: 'oauth', label: oauth.loginLabel ?? oauth.name })
  const apiKey = provider?.auth.apiKey
  if (apiKey?.login !== undefined) methods.push({ id: 'api-key', label: apiKey.name })
  return methods
}

/**
 * Restate one pi-ai login event in the seam's vocabulary.
 *
 * A device-code grant is the one event carrying two things the human needs at
 * once — where to go and what to type there — which is why the neutral notice
 * has a `code` beside its `url` rather than folding the code into the message.
 * @param event - what pi-ai reported.
 * @param session - the attempt to report it to.
 */
function relay(event: AuthEvent, session: AuthorizationSession): void {
  switch (event.type) {
    case 'info': {
      const link = event.links?.[0]
      session.notify({ message: event.message, ...link === undefined ? {} : { url: link.url } })
      return
    }
    case 'auth_url':
      session.notify({
        message: event.instructions ?? 'Open this page to continue signing in.',
        url: event.url,
      })
      return
    case 'device_code':
      session.notify({
        message: 'Enter this code on the verification page to finish signing in.',
        url: event.verificationUri,
        code: event.userCode,
      })
      return
    case 'progress':
      session.notify({ message: event.message })
      return
    default:
      // pi-ai's event union is open to new members: a build that meets one it
      // does not know still shows the human that something is happening rather
      // than going silent mid-login.
      session.notify({ message: 'Signing in…' })
  }
}

/**
 * Restate one pi-ai prompt in the seam's vocabulary.
 *
 * `manual_code` becomes a plain text question because the difference pi-ai
 * draws — a code the human copies from a browser rather than a value they know
 * — changes nothing a surface renders. Its own `signal` is carried through, and
 * that is the part which matters: it is how a flow racing a typed code against
 * a browser callback withdraws the losing question.
 * @param prompt - what pi-ai asked.
 * @returns the neutral prompt to put to the human.
 */
function restate(prompt: AuthPrompt): AuthorizationPrompt {
  const signal = prompt.signal === undefined ? {} : { signal: prompt.signal }
  switch (prompt.type) {
    case 'select':
      return { ...signal, kind: 'select', message: prompt.message, options: prompt.options }
    case 'secret':
      return {
        ...signal,
        kind: 'secret',
        message: prompt.message,
        ...prompt.placeholder === undefined ? {} : { placeholder: prompt.placeholder },
      }
    default:
      return {
        ...signal,
        kind: 'text',
        message: prompt.message,
        ...prompt.placeholder === undefined ? {} : { placeholder: prompt.placeholder },
      }
  }
}

/** Authorization flow for one route backed by an installed catalog provider; `route` owns the credential record. */
function flowFor(auth: PiAiAuthInjection, route: string, baseId: string, label?: string): AuthorizationFlow | undefined {
  const base = catalogProvider(baseId)
  const [first, ...rest] = loginMethods(base)
  /* v8 ignore next 3 -- every installed catalog id ships a login */
  if (base === undefined || first === undefined) return undefined
  const provider: Provider = route === baseId ? base : { ...base, id: route }
  const borrowedFrom = BORROWED_APP_LOGINS.get(baseId)
  return {
    key: recordKeyFor(route),
    label: label ?? provider.name,
    methods: [first, ...rest],
    ...borrowedFrom === undefined ? {} : { borrowedFrom },
    async run(session) {
      const models = createModels(auth)
      models.setProvider(provider)
      const type: AuthType = session.method === 'oauth' ? 'oauth' : 'api_key'
      await models.login(route, type, {
        signal: session.signal,
        notify: (event) => { relay(event, session) },
        prompt: prompt => session.prompt(restate(prompt)),
      })
    },
  }
}

/**
 * Register one authorization flow per installed provider that ships a login.
 * @param ctx - the plugin context carrying `ctx.authorization`.
 * @param auth - the injectables every collection here is built with.
 * @returns a sync function that makes the alias routes (route to base provider id) the offered extra flows.
 */
export function registerPiAiFlows(
  ctx: Context,
  auth: PiAiAuthInjection,
): (aliases: ReadonlyMap<string, { base: string; label: string }>) => void {
  const catalogIds = new Set(catalogProviderIds())
  for (const providerId of catalogIds) {
    /* v8 ignore next 7 -- an installed id outside the record grammar would otherwise fail the whole mount */
    if (!isCredentialKeySegment(providerId)) {
      ctx.logger.warn(
        'llm-pi-ai: catalog provider "%s" cannot address a credential record; its sign-in is not offered',
        providerId)
      continue
    }
    const flow = flowFor(auth, providerId, providerId)
    if (flow !== undefined) ctx.authorization.registerFlow(flow)
  }
  const live = new Map<string, { base: string; label: string; dispose: () => void }>()
  return (aliases) => {
    for (const [route, entry] of live) {
      const next = aliases.get(route)
      if (next?.base === entry.base && next.label === entry.label) continue
      entry.dispose()
      live.delete(route)
    }
    for (const [route, { base, label }] of aliases) {
      if (live.has(route) || catalogIds.has(route) || !isCredentialKeySegment(route)) continue
      const flow = flowFor(auth, route, base, label)
      if (flow !== undefined) live.set(route, { base, label, dispose: ctx.authorization.registerFlow(flow) })
    }
  }
}

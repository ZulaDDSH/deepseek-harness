# llm-pi-ai code notes

## Multi-account Claude: route aliases

- `packages/llm/llm-pi-ai/src/config.ts:PiAiProviderProfile.base` — a route key normally equals the installed pi-ai catalog
  provider id, so `anthropic` could hold one sign-in only. `base` names the catalog provider a route is a second account of
  (for example route `claude-work` with `base: 'anthropic'`). Credentials stay keyed by the route key, so every alias has
  its own `llm-pi-ai/<route>` record and its own OAuth login; models, auth methods and dispatch come from the base provider.
- `packages/llm/llm-pi-ai/src/config.ts:resolveProfiles` — rejects a `base` that is the route itself or not an installed
  catalog provider. The error is thrown in both strict and deferred modes because it is a configuration mistake, not a
  catalog-upgrade diagnostic.
- `packages/llm/llm-pi-ai/src/catalog.ts:resolveRouteModels` — catalog lookups (default models, provider endpoint) use
  `request.base ?? provider`; the materialized models still carry the route key as `provider`, so selectors and requests
  address the alias, not the base.
- `packages/llm/llm-pi-ai/src/provider.ts:buildProvider` — looks the catalog provider up by `spec.base ?? spec.provider`
  and keeps `id: spec.provider`, so pi-ai resolves credentials under the alias route.
- `packages/llm/llm-pi-ai/src/login.ts:registerPiAiFlows` and `src/index.ts` — sign-in flows are registered per route:
  catalog ids at mount, alias routes whenever the `providers` profiles change, and disposed when an alias is removed.
- `packages/llm/llm-pi-ai/src/claude-quota.ts:createClaudeQuotaSource` — quota is per account: one source and one usage
  store per route whose base is `anthropic`, so rate-limit headers from one account never show on another's meter.

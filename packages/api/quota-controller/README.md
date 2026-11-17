---
description: "Host Remote service for credential-backed provider quota and balance reads exposed to browser clients."
kind: "package-reference"
---

# @deepseek-ai/dsh-api-quota-controller

## Summary

Use this package when a browser surface needs normalized provider quota or balance data without receiving credential values. It exposes configured providers through the `quota` Remote namespace, resolves credentials on the Host, coalesces concurrent reads per provider, and returns only client-safe usage fields. The built-in registry covers DeepSeek credits and OpenCode Go windows and can be extended by Host composition.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the package in a Host composition that also provides `ctx.credentials` and the Remote gateway. `listProviders()` reports every built-in provider and every registered source, set up or not, and `fetch(providerId)` reports whether that provider is configured and, if so, its normalized quota state; an unset built-in provider reports `Set up <name> in Settings > Models`. The credential itself is never returned. Concurrent reads share one pending request; completed and failed requests release it so later reads can retry.

The built-in providers read DeepSeek account credits and OpenCode Go rolling quota windows. The DeepSeek credit provider is registered under the `deepseek-official` route id, so it merges with the connected official DeepSeek route instead of listing a second row; it reads `DEEPSEEK_API_KEY`, the credential reference the Models page writes. Deployment code can supply additional `QuotaProvider` entries through `QuotaControllerInternals`. Providers with their own authentication register a `QuotaSource` through `registerSource()` and retain its disposer through a Cordis effect; the source resolves and refreshes its own credentials.

The Anthropic (Claude) source is registered by `llm-pi-ai`. It reports the five-hour, weekly, per-model weekly, and overage windows the harness observed on its own Anthropic responses and Claude Agent SDK runs, and it makes no network request. The composer's near-limit share is the `quota-controller` namespace's `nearLimitPercent`: a whole percent from 50 to 100, default 90. The client reads it to decide when to warn; this package only declares and holds the setting.

-----

<a id="model-experience"></a>
## Model Experience

None, as the Host quota API returns credential-backed provider usage to browser clients and registers no prompt, tool, or Session event.

#### KV Cache effect

No direct effect; quota reads happen outside model requests and do not alter reusable model-request prefixes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Provider APIs are queried on demand, and only fields required by the quota presentation are normalized; unsupported provider fields are not exposed.
- A DeepSeek route configured with a custom `apiKeyEnv` is not followed; the quota reads `DEEPSEEK_API_KEY` or the pi-ai `deepseek` record.
- The OpenAI Codex read (`https://chatgpt.com/backend-api/wham/usage`) is not a documented API and may change without notice. The OpenCode Go read (`https://opencode.ai/zen/go/v1/usage`) has not been checked against published documentation.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No invariant companion is published because the controller does not own a cross-package runtime assertion contract.

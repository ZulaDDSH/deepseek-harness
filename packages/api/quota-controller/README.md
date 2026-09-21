---
description: "Host Remote service for credential-backed provider quota and balance reads exposed to browser clients."
kind: "package-reference"
---

# @deepseek-ai/dsh-api-quota-controller

English | [中文](README.zh.md)

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

Mount the package in a Host composition that also provides `ctx.credentials` and the Remote gateway. `listProviders()` reports only providers with a resolvable credential, while `fetch(providerId)` returns normalized quota state and never returns the credential itself.

The built-in providers read DeepSeek account credits and OpenCode Go rolling quota windows. Deployment code can supply additional `QuotaProvider` entries through `QuotaControllerInternals`.

-----

<a id="model-experience"></a>
## Model Experience

None, as the Host quota API returns credential-backed provider usage to browser clients and registers no prompt, tool, or Session event.

#### KV Cache effect

No direct effect; quota reads happen outside model requests and do not alter reusable model-request prefixes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Provider APIs are queried on demand, and only fields required by the quota presentation are normalized; unsupported provider fields are not exposed.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No invariant companion is published because the controller does not own a cross-package runtime assertion contract.

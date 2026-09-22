---
description: "Optional TypeSafe Jev decision routing and credential setup for DeepSeek Harness."
kind: "package-reference"
---

# @deepseek-ai/dsh-llm-jev-router

English | [中文](README.zh.md)

## Summary

Use this package when an Agent step should ask TypeSafe Jev to choose from an explicit allowlist of DSH provider/model routes. It is disabled by default, preserves the existing route when disabled or when fail-open handling admits a Jev failure, and stores its API key through DSH credentials rather than settings text. Jev remains a separate decision request and does not become a normal DSH model provider.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin in the base composition. Open **Settings → Models → TypeSafe / Jev** and enter the key. The editor stores it under the `TYPESAFE_API_KEY` credential reference; headless deployments can provide that reference through the launch environment.

### Minimal configuration

```yaml
- name: '@deepseek-ai/dsh-llm-jev-router'
  config:
    enabled: true
    apiKeyEnv: TYPESAFE_API_KEY
    routes:
      - id: lean
        provider: claude-code
        model: claude-sonnet
        description: Short, routine, low-risk tasks
      - id: powerful
        provider: claude-code
        model: claude-opus
        description: Complex architecture, debugging, or multi-step tasks
```

The Models page writes the key through the credentials service and never places the secret in this configuration. `fallback: keep` preserves the original route when Jev is uncertain or unavailable; `failOpen: false` rejects the step instead.

-----

<a id="model-experience"></a>
## Model Experience

### Jev routing request

#### What the model sees

The independent Jev request receives bounded state derived from admitted user messages plus the configured route choices and their descriptions. The selected DSH provider/model receives its normal request; the Jev response itself is not appended to that model's prompt.

#### Token effect

When routing is enabled and admitted, the package creates a separate TypeSafe Jev request using the bounded `stateMaxChars` state and route-choice payload. It adds no prompt tokens to the selected DSH provider request beyond whatever route that provider already receives.

#### KV Cache effect

The Jev request has an independent cache lifecycle from the selected DSH provider request. Changing Jev state, routes, endpoint, or model can change that decision request, but this package does not rewrite the selected provider's reusable prompt prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Route descriptions and provider/model identifiers are configuration-owned and must match routes available in the active DSH composition; the plugin does not discover or add missing routes automatically.
- Fail-open behavior preserves the base route when Jev fails, so deployments that require routing to succeed must explicitly set `failOpen: false`.
- A model selection already stored on the session is authoritative: when the resolved route came from that selection, the Jev suggestion is discarded rather than applied. Compositions without the `sessionProjections` service have no stored selection to honor and route the assembled default.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The HTTP API uses `https://api.typesafe.ai/v1/systemone` with model `jev-latest`. Keep credentials in the DSH credential service or launch environment, never in source, YAML, logs, or pull requests.

</details>

**Runtime invariant:** No invariant companion is published because focused router validation and request-path tests own this package's runtime checks.

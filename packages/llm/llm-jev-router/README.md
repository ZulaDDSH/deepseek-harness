---
description: "Optional TypeSafe Jev decision routing and credential setup for DeepSeek Harness."
kind: "package-reference"
---

# @deepseek-ai/dsh-llm-jev-router

English | [中文](README.zh.md)

## Summary

`@deepseek-ai/dsh-llm-jev-router` optionally asks TypeSafe Jev to choose an allow-listed DSH provider/model for each agent step. It is disabled by default, keeps existing provider selection unchanged when disabled or unavailable, and stores the API key through DSH credentials rather than settings text.

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

Jev receives bounded state for the admitted user messages, returns a typed Choice with confidence, and the selected route is applied in the agent request waterfall. Retries reuse the decision for the same agent turn and step. Jev is a decision layer, not an LLM provider, so it does not appear in the normal model catalog.

-----

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

The route descriptions and provider/model identifiers are configuration-owned; they must match routes available in the active DSH composition. The plugin is fail-open by default and does not automatically add providers or models to the allowlist.

-----

<a id="dev-note"></a>
## Dev Note

The HTTP API uses `https://api.typesafe.ai/v1/systemone` with model `jev-latest`. Keep credentials in the DSH credential service or launch environment, never in source, YAML, logs, or pull requests.

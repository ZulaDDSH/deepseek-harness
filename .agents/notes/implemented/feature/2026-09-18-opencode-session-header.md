# Agent Note: OpenCode session header for pi-ai routes

Status: implemented

English | [中文](2026-09-18-opencode-session-header.zh.md)

## Problem

OpenCode Go requires every model request to carry a stable conversation identity in `x-opencode-session` so its gateways can route the request and keep prompt caching coherent; a request without it fails before inference with a 400 `MissingSessionID`. The harness reaches OpenCode routes through `dsh-llm-pi-ai`, and `@earendil-works/pi-ai` (0.85.1, npm `latest`) never emits that header: its `sessionId` option only produces provider-native cache-affinity fields, and `sendSessionAffinityHeaders` defaults off for OpenCode routes. The value the provider asks for was already on the request as `GenerateOptions.sessionId` — the agent loop stamps the durable `Session.id` on ordinary, title, and compaction calls — but no adapter mapped it to the header OpenCode documents, so OpenCode Go was unusable from the harness.

## Decision

`dsh-llm-pi-ai` sets `x-opencode-session` from `GenerateOptions.sessionId` on any model request whose resolved pi-ai model belongs to an OpenCode gateway. A route belongs to one when the model's pi-ai provider id is `opencode` or `opencode-go`, or the hostname parsed from the model's request base URL is exactly `opencode.ai` or `www.opencode.ai`. The hostname is compared, not a substring of the URL, so a lookalike such as `opencode.ai.example.com` is not an OpenCode gateway and never receives the conversation identity. A base URL that does not parse is not one either. The check runs in the adapter before the wire API is selected, so `openai-completions`, `openai-responses`, and `anthropic-messages` models all carry it. A request with no session id sends none, because there is no conversation identity to name.

A profile that already configures `x-opencode-session` in its `headers` keeps its own value, whatever the case it spelled the name in; the session id is written only when the request carries none, since the profile owns the transport it speaks and the harness value is a fallback for the routes given no header. Attribute names never collide with it, because `attributionHeaders()` carries no OpenCode header and the merge only dedupes what it does carry.

The header is model-hidden transport metadata. Its value never enters the request body, system prompt, token accounting, KV-cache identity, or session log, and it is not a session event. It sits beside the shared `User-Agent` from [Mandatory app attribution headers](../architecture/2026-06-21-mandatory-app-attribution-headers.md) and follows the same privacy boundary as the provider-specific identity headers in [DeepSeek request user and session identity headers](2026-08-11-deepseek-request-user-id-header.md).

## Verification

- The `dsh-llm-pi-ai` wire test sends the exact session id on an `opencode-go` route and asserts the header is absent on a plain route, using the adapter's real profile and model resolution over a local HTTP server.
- A route whose base URL names a lookalike host receives no header, and a profile that configured the header itself keeps its own value and spelling.
- The header is not model-visible, so no keyless recorded-session snapshot changes.

## Alternatives considered

| Rejected | Reason |
|---|---|
| Set a fixed `x-opencode-session` value through the profile `headers` dict | A fixed value cannot carry the conversation identity, so every conversation would share one routing and caching lane; the deployment cannot derive the current session id, which belongs to the owning runtime contract |
| Rely on pi-ai's `sessionId` option or enable `sendSessionAffinityHeaders` | pi-ai 0.85.1 emits only `session_id`, `x-client-request-id`, and `x-session-affinity`; none is the header OpenCode names, and the option is provider-native cache affinity rather than OpenCode's routing contract |
| Add the value to the provider-neutral `attributionHeaders()` helper | That helper is static app identity; a per-conversation value there would reach unrelated providers and violate its purpose |
| Set the header in the Host service or the browser UI | The header belongs to each model request and the adapter is the only layer that owns the resolved provider, model, and session id together |
| Patch the vendored or installed pi-ai provider | The provider is not vendored, and pinning a fork for one header duplicates the harness's own adapter contract; the adapter already owns per-request transport metadata |

## Consequences

- OpenCode Go requests now carry the durable conversation id, satisfying the provider's routing and prompt-caching requirement on every model path.
- The header does not alter the request body, prompt, token count, KV-cache prefix, or session log; no snapshot changes.
- A custom route whose parsed hostname is `opencode.ai` or `www.opencode.ai` is treated as an OpenCode gateway and receives the header; a route pointed at a non-OpenCode endpoint, including a lookalike host, is not affected.
- A profile that configures `x-opencode-session` itself keeps that value, so its own routing choice is not overridden; the session id applies only to routes that configured none.
- The mapping is conditional on `GenerateOptions.sessionId`; a call that carries no session id still sends nothing, so a future caller that must reach OpenCode Go has to supply one.

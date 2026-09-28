---
description: "Host Remote owner for settings and credential configuration surfaces, including redacted reads, writes, credential references, and native document opening."
kind: "package-reference"
---
# Settings Controller

English | [中文](README.zh.md)

## Summary

`@deepseek-ai/dsh-api-settings-controller` exposes generated `ctx.remote.settings`, `ctx.remote.credentials`, and `ctx.remote.authorization` namespaces for browser configuration surfaces. It returns redacted settings and credential metadata, supports settings and credential writes without returning secret values, runs human-guided sign-ins, and opens provider-owned settings or Agent preset locations on the Host desktop. When a provider is absent, the namespace remains registered and returns an actionable configuration error.

## Table of Contents

- [Use this package](#use-this-package)
- [Configuration](#configuration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this package as a Loader entry in a profile that serves browser configuration. The entry registers both namespaces independently of their providers so a missing provider produces a named configuration error at invocation. Its generated descriptors enter the strict Typert registry, while the settings and credential Definitions remain plain Cordis Services with no wire obligations of their own.

`describe(refs)` answers one map keyed by the requested names, so a settings page describing every reference its rows carry settles those rows together. It accepts at most 64 names per call, reports an invalid name or empty write value as `bad-request`, and copies each answer field by field — a provider returning more than `CredentialInfo` declares cannot widen what crosses. Valid `set(ref, value)` and `unset(ref)` calls report a provider refusal as `credential-rejected`, carrying the provider's message with only the reference in its details. Secret values cross in this direction only: no method here returns one.

`settings.describe()` returns deployment facts and every namespace under `redactSecrets: true`. `settings.update`, `settings.replace`, and `settings.mutate` expose the settings service's three write operations and return the namespace's new redacted view; stale writes use `settings-conflict` and other provider refusals use `settings-rejected`.

`settings.openSettingsDocument()` prepares the provider-owned document and opens it with the native text editor; it accepts no browser-supplied filesystem target.

`authorization.list()` answers every flow the mounted registry offers, each joined with whether a credential is already stored for its key, so a surface can label a signed-in provider without a second call. `authorization.begin(key, method, signal)` is a stream: its first item names an unguessable per-attempt capability, every later item is a notice from the flow, and the last names how the attempt ended. `authorization.answer(attempt, prompt, value)` answers a question and `authorization.cancel(attempt)` withdraws the attempt, both addressed by that capability.

A notice can carry an authorization URL, a device code, or a question, so it is delivered only on the stream that opened the attempt and never published on a Host-wide channel: a second client receives none of the first client's notices and cannot answer or cancel an attempt it did not start. The attempt settles as `authorized` or `cancelled`; a genuine flow failure rejects the stream with `authorization/failed`, carrying the key and the flow's own reason code, and an unknown key, capability, or question is `authorization/not-found`. The first stream item is delivered before the flow says anything, so a caller always holds the capability it needs to answer or withdraw.

-----

<a id="configuration"></a>
## Configuration

| Field | Default | Meaning |
|---|---|---|

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-api-settings-controller) is the exhaustive source for accepted fields and their JSDoc.

-----

<a id="model-experience"></a>
## Model Experience

None, as settings and credential configuration are browser and Host state and register no prompt, tool, or session event.

#### KV Cache effect

No direct effect; reading or writing these configuration values does not alter model requests already in flight.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The batch bound is fixed at 64 references and is not a deployment-configurable field.
- **An authorization attempt is not durable** — the attempt capability lives in the Host process, so a page reload mid-sign-in abandons the attempt and the human starts over.
- **A question is answered by a second call, not a reply** — the Remote wire has no reverse channel inside a call, so a surface that loses a question notice cannot answer a prompt it was never shown.
- **An attempt belongs to the client that opened it** — the capability is delivered only on that client's stream, so nothing else can observe or act on the attempt. A second browser tab cannot adopt a sign-in already in progress.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The settings and credential seams own storage and update events, while this package only projects their methods onto the wire.

---
description: "Browser session-header quota popover for provider usage, reset windows, balances, and durable session token totals."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-provider-quota

English | [中文](README.zh.md)

## Summary

Use this package to show provider quota and session token usage in the conversation header. It reads configured provider results from the Host `quota` Remote namespace, renders percentage windows, balances, reset times, and provider status, and can show the current Session's durable token total. It owns presentation and refresh state only; provider credentials and quota requests remain on the Host.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the client plugin in a web composition that includes the Remote, locale, conversation, and renderer dependencies declared by the package. The plugin adds a compact usage control to `conversation.session.header.utilities` and refreshes provider quota through the Host service.

The popover shows only providers returned by the Host registry. When Session projection data is available, it also displays the durable token total for the current Session.

-----

<a id="model-experience"></a>
## Model Experience

None, as browser-side quota presentation reads existing Remote and token-usage state without registering model-facing context.

#### KV Cache effect

No direct effect; opening or refreshing the quota surface does not alter model requests or reusable request prefixes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Only providers returned by the Host quota registry are shown; unsupported providers are not inferred from model settings.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No invariant companion is published because this browser presentation package does not own a cross-package runtime assertion contract.

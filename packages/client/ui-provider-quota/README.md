# Provider Quota Header

The browser plugin adds a compact usage icon to `conversation.session.header.utilities`. Its popover lists each configured provider's windows with a used bar, a tone-coded metric (success below 50%, warning from 50%, error from 80%), the next reset, and a non-`ok` provider status verbatim in place of the percentage, refreshes through the `quota` Remote namespace, and localizes loading, empty, error, and window labels.

## Model Experience

This package is presentation-only and does not change model prompts, tools, token accounting, or KV-cache behavior.

## Known Limitations and Deferred Work

Only providers returned by the Host quota registry are shown; unsupported providers are not inferred from model settings.

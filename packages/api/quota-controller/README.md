# Provider Quota Controller

The Host service exposes configured provider quota readers through the `quota` Remote namespace. Credentials are resolved by `ctx.credentials` and never returned to the Client. The registry currently includes DeepSeek credits and OpenCode Go rolling quota windows and accepts additional `QuotaProvider` entries through `QuotaControllerInternals`. A window carries the provider's own `status` token verbatim when it reports one, so a limit that cannot serve is visible even without a percentage.

## Model Experience

This package does not change model prompts, tools, token accounting, or KV-cache behavior.

## Known Limitations and Deferred Work

Provider APIs are queried on demand and are limited to the provider response fields needed by the header usage popover.

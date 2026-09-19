# Agent Note: Curated pi-ai catalog supplement

Status: implemented

English | [中文](2026-09-18-pi-ai-catalog-supplement.zh.md)

## Problem

pi-ai generates its provider catalogs from [models.dev](https://models.dev) and publishes them inside a versioned package, so a model a provider adds between pi-ai releases is absent from the harness until the dependency is upgraded. OpenCode Go added DeepSeek V4.1 Flash after `@earendil-works/pi-ai@0.85.1` (npm `latest`) shipped, so the model was missing from every selector and could not be requested. The existing configuration cannot fill the gap: a profile's `models` list replaces the route's whole catalog, and a route `api` override applies to every model, so a chat-completions model cannot be added to opencode-go's mixed catalog (anthropic-messages, openai-completions, and openai-responses) without dropping its other models. opencode itself — and OpenChamber, which wraps it — reads models.dev live, so it lists the model without a client update; the harness builds offline and reproducibly and does not fetch a catalog at request time.

## Decision

`dsh-llm-pi-ai` ships a checked-in supplement (`src/catalog-supplement.ts`) of models the pinned pi-ai catalog does not describe, transcribed from models.dev — the same upstream source pi-ai generates from. Each entry is the full pi-ai `Model` including the protocol, endpoint, capacities, modalities, cost, and the provider quirks (thinking format, reasoning-content replay) a raw models.dev row does not spell out. `catalogModels()` merges the supplement after the installed entries, and an installed entry of the same id always wins, so a pi-ai upgrade that ships the model makes its supplement entry a no-op to be deleted. The first entry is opencode-go's `deepseek-v4.1-flash`.

A wrong field on a model the installed catalog already describes is a `modelOverrides` edit, not a supplement: the supplement exists only for the data gap, not for correction.

## Verification

- The catalog spec asserts the supplemented id is listed on its route, materializes with the route's protocol and endpoint, and does not displace an installed id.
- No keyless recorded-session snapshot changes: the supplement changes the offered catalog, not request, transcript, or persisted content.

## Alternatives considered

| Rejected | Reason |
|---|---|
| Fetch models.dev or the provider's `/models` endpoint at boot or request time | The harness builds offline and reproducibly and its tests replay without network; a live catalog would add a network dependency, cache, and failure mode to every boot, and its contents would vary by network |
| Configure the route's `models` list in settings | A `models` list replaces the whole catalog and a route `api` applies to every model, so adding one chat-completions model to opencode-go's mixed catalog would drop its anthropic and responses models |
| Widen `modelOverrides` to introduce ids the catalog does not describe, with a per-model protocol field | Changes a documented field's meaning (reshape installed models) into a second catalog mechanism and needs a per-model protocol that the mixed-route case would then exercise; the supplement owns the data gap without per-user configuration |
| Upgrade or fork pi-ai | No published pi-ai release ships the model; forking a dependency for one generated catalog row duplicates the harness's own seam |
| Amend the installed or vendored pi-ai catalog data | pi-ai is not vendored; editing `node_modules` is not reproducible and survives no install |

## Consequences

- A catalog route serves a provider's newest model with no configuration entry and no dependency upgrade; model data now lives in a second place, kept small and retired by pi-ai upgrades.
- A supplemented model's metadata is only as current as the change that added it.
- The supplement applies only to the provider ids it names; a hand-declared route or another provider is unchanged.

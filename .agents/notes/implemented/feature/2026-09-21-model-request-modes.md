# Agent Note: Model request modes in the pi-ai catalog

Status: implemented

English | [中文](2026-09-21-model-request-modes.zh.md)

## Problem

Codex's fast mode is a service tier on the same model, not a separate model: the CLI toggles `service_tier = "fast"` in `~/.codex/config.toml`, its model catalog advertises `additional_speed_tiers: ["fast"]` for every model, and the request carries `service_tier: "fast"`. A harness route cannot express that today — a pi-ai `Model` has no tier field, and `ModelSelection` carries only provider, model, and reasoning effort — so the picker offers no way to ask for it.

OpenCode, the engine under OpenChamber, solves this in its catalog rather than in a selection type: a model's `experimental.modes` entry (`{ fast: { provider: { body: { service_tier: "priority" } } } }`) expands into an extra model whose id is `<id>-<mode>` and whose name is `<Name> Fast`, carrying the mode's request options. Reasoning effort and service tier are both per-model request facts there, not fields of a selection record.

## Decision

`dsh-llm-pi-ai` model entries and `modelOverrides` values accept `modes`, a dict of named request modes. Each mode resolves to an extra catalog entry — id `<id>-<mode>`, name `<name> <Mode>`, overridable with `name` — inheriting the resolved model's protocol, capacities, modalities, reasoning, and compatibility switches. The mode's `serviceTier` is recorded beside the catalog in `RouteCatalog.modeRequests` rather than on the `Model`, because pi-ai's `Model.id` is both the harness's key and the provider's model name: the entry needs its own key for the picker and the session log while the provider must still receive the model it extends.

A mode is refused on a protocol that carries no service-tier request option (`openai-codex-responses`, `openai-responses`), and for an empty mode name, an empty `serviceTier`, or an id another entry claims.

The tier reaches the request through pi-ai's `onPayload` hook rather than its `serviceTier` option. Both Responses implementations rebuild their stream options inside `streamSimple` from the fixed field list in `buildBaseOptions`, so the option never survives the entry point this adapter dispatches through, while `onPayload` does — it is pi-ai's own hook for request fields it does not model. pi-ai keys its service-tier cost multiplier off the option, so that multiplier does not apply; `TokenUsage` carries no price and no consumer reads one.

Selecting a mode leaves `ModelSelection` unchanged: the session records the mode's model id, the picker renders it like any other row, and no session event, projection, SDK, or ACP type changes. See [Curated pi-ai catalog supplement](2026-09-18-pi-ai-catalog-supplement.md) for the sibling mechanism that owns model data the pinned release lacks, and [OpenCode session header](2026-09-18-opencode-session-header.md) for the other OpenCode-derived transport fact this adapter carries.

## Verification

- `packages/llm/llm-pi-ai/tests/catalog.spec.ts` asserts the expansion's id and name, its inheritance of capacities, modalities, and reasoning, a declared `name`, and the refusal of an unsupported protocol, an empty tier or mode name, and a colliding id.
- `packages/llm/llm-pi-ai/tests/adapter.spec.ts` asserts the wire body: a mode entry sends `model` set to the model it extends with `service_tier` set, and its base model sends neither.
- No keyless recorded-session snapshot changes: the offered catalog changes, not request, transcript, or persisted content.

## Alternatives considered

| Rejected | Reason |
|---|---|
| Add a service-tier field to `ModelSelection`, the request header, the `model/selection` event, and the `modelSelection` projection | A durable selection dimension costs a projection version bump, both SDK projections, ACP config options, and the subagent tool schema for one provider's tier; the catalog entry carries the same fact with none of them |
| Pass pi-ai's `serviceTier` stream option | Both Responses `streamSimple` implementations drop it while rebuilding options from `buildBaseOptions`, so it would look applied and send nothing |
| Dispatch mode requests through `models.stream()` instead of `streamSimple()` | `stream()` takes protocol-specific options, so the harness would re-implement pi-ai's per-protocol thinking-level and budget translation — the behavior `streamSimple` exists to own |
| Ship the fast modes as a catalog supplement | The supplement owns model data the pinned pi-ai release lacks; a mode is a deployment's choice of tier spelling, and the provider's own catalog is where the capability is advertised |

## Consequences

- A route offers fast and standard rows for the same model from one configuration entry, and the picker, the subagent model listing, and the settings surfaces show both without changes.
- The mode id is what the session logs, so removing a mode later leaves historical sessions naming a model the route no longer serves.
- Modes are declared per model; a route that adds a model inherits nothing from a sibling's declaration.

# Agent Note: Selectable request modes for pi-ai models

Status: implemented

English | [中文](2026-09-25-pi-ai-request-modes.zh.md)

## Problem

Codex fast mode changes the service tier of a model request while keeping the provider model id. A selectable mode needs its own model id in the harness without sending that alias to the provider.

## Decision

`PiAiModelProfile.modes` in `packages/llm/llm-pi-ai/src/catalog.ts:PiAiModelProfile` expands each mode to `<id>-<mode>` and inherits the resolved model. `RouteCatalog.modeRequests` maps the selectable id to the provider model id and service tier. `PiAiAdapter.streamWithSnapshot` restores the provider id for pi-ai and sets `service_tier` through `onPayload`, which the Responses APIs accept; resolution rejects empty tiers, colliding ids, and other protocols. The harness keeps the selected alias as the session model id, so no session type or SDK projection changes.

`SimpleStreamOptions` reaches pi-ai's Responses implementations through `buildBaseOptions`, which preserves `onPayload` but omits `serviceTier`; the payload hook carries this unmodeled request field.

## Verification

`packages/llm/llm-pi-ai/tests/catalog.spec.ts` covers Codex `modelOverrides`, mode inheritance, protocol and value rejection, ID collisions, and deferred duplicate cleanup. `packages/llm/llm-pi-ai/tests/adapter.spec.ts` checks the provider model id and tier on a mode request and the absence of a tier on the base request. The adapter check verifies serialization against a mock endpoint.

## Alternatives considered

**Add the tier to `ModelSelection` and its session event.** That would extend durable selection and its SDK projections for one provider request option; the catalog entry carries the choice under the existing session model id.

**Pass pi-ai's `serviceTier` stream option.** The shared simple-options builder drops that field before the Responses request is built, while `onPayload` is retained.

## Consequences

Mode ids are durable session model ids. Removing a configured mode stops new requests through that id, while existing sessions retain the historical selection.

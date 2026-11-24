# Agent Note: PTC is the default tool executor

Status: implemented

## Problem

Every shipped composition mounted `@deepseek-ai/dsh-tool-executor-native`, so models received one JSON schema per tool and each tool call cost a model round trip, while the PTC executor (`run_code`) was reachable only through the Web `ptc` preset, the `ptc.yml` overlay, and the deprecated `tool-presentation` mode. Executor selection is by which executor plugin a scope mounts, so making PTC the default meant changing the shared base rows, not a per-model switch.

## Decision

- The `dsh-base` bundle mounts `tool-executor-ptc` enabled and `tool-executor-native` with `disabled: true`; `ptc-runtime` (`@deepseek-ai/dsh-ptc-runtime-node`) is mounted in the same bundle, so web, desktop, headless, and SDK app compositions run `run_code` with the sandbox fail-closed path and per-nested-call approvals unchanged.
- Native stays mountable as an explicit opt-out: the shipped `apps/cli/config/examples/native.yml` overlay swaps the two rows, and any preset or patch may state `tool-executor-native` with `disabled: false` and `tool-executor-ptc` with `disabled: true`.
- The `acp-app` bundle pins native, because the ACP bridge projects only top-level `tool/call` and `tool/result` events and nested PTC calls would raise permission requests for tool call ids the client was never told about.
- `sdk-minimal` stays native: it is standalone and mounts no PTC runtime.
- The Web presets `standard`, `cordis`, `lean`, `master`, and `minimal` state no executor row and inherit the base; the `ptc` preset keeps its own row.
- No per-model or per-provider tool-set mechanism was added: no such selection exists, `run_code` carries images, structured subagent output, and approvals, and the caveats are documented in the PTC runtime subsystem doc.
- Test infrastructure that scripts native tool calls (keyless SDK e2e files, office skill e2e files, the web scaffold, the headless fixture patches, and the shared snapshot base compositions) pins native, because the replay fixtures cannot be re-recorded without a provider key.

## Alternatives considered

**Add a `native` Web preset and flip only the preset roster default.** It would change the roster, locales, and UI for a setting that the executor row already expresses, and it would leave headless and SDK on native.

**Make PTC the default per model or provider.** No per-model tool-set selection exists, and adding one for a global default is a second configuration axis with no evidence that a provider needs it.

**Remove the native row.** Existing overlays such as `ptc.yml` and the 38 snapshot patches state both row ids, and the opt-out needs the row.

**Re-record every snapshot under PTC.** Recording needs a provider key and fixtures replay only on macOS and Linux; the existing `ptc-*` scenarios already cover the PTC path.

## Consequences

Default model requests carry one `run_code` schema plus the `tools:ptc-only` guidance instead of per-tool schemas, and direct calls to any other tool name return `UNKNOWN_TOOL`. Deployments that scripted direct tool calls must opt out with the native overlay, as the [upgrade guide](../../../../docs/upgrade-guide/v0.2.2-rc.3/ptc-default/guide.md) describes. The pinned test infrastructure means the default composition's PTC path is covered by the dedicated `ptc-*` scenarios and the executor-default spec, not by the generic snapshots.

## Testing

`packages/bundle/web-app/tests/tool-executor-default.spec.ts` composes each bundle and overlay and asserts which executor rows and the PTC runtime are enabled: PTC for base, headless, SDK app, and web app; native with `native.yml`; native again after `native.yml` then `ptc.yml` flips back; native for `acp-app`; native without a runtime for `sdk-minimal`; and no executor row in the inheriting presets.

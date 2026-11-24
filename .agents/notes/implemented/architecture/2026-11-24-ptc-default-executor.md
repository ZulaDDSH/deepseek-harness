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
- No per-model or per-provider tool-set mechanism was added: no such selection exists, `run_code` carries images, structured subagent output, and approvals, and the caveats (time budget, single schema, `UNKNOWN_TOOL` on direct calls, nested approvals) are in the "Running as the default executor" section of the [PTC runtime subsystem doc](../../../../docs/subsystems/ptc-runtime.md).
- A host that cannot confine programs keeps its non-shell tools. The runtime still fails closed with `sandbox-unavailable`, because a program has full Node authority, but the first such result latches `PtcCalls.confinementUnavailable`; from the next model step `PtcExecutor.describe` presents every tool schema, the `tools:ptc-only` and `tools:sdk` sections render empty, and direct calls are accepted. Only the shell then fails closed, as under native execution. The runtime reports `sandbox-unavailable` from exit output only before the worker's readiness handshake (`Worker` checks `ready`), so stderr a started program writes cannot forge it. `ToolExecutor.describe` receives the pre-restriction known names as a second argument, so the latched branch keeps `run_code` and every registered tool valid in `toolOrder`. The latch lasts for the executor's lifetime and does not apply to registered program tools such as `cua_run_code`.
- The Web `ptc` preset keeps its own executor row and `economy` keeps its `tool-presentation` row with `mode: ptc`.
- Under the default, `cua_run_code` is reached as `tools.cua_run_code(...)` inside a `run_code` program.
- Test infrastructure that scripts native tool calls (keyless SDK e2e files, office skill e2e files, the web scaffold, the headless fixture patches, and the shared snapshot base compositions) pins native, because the replay fixtures cannot be re-recorded without a provider key.

## Alternatives considered

**Add a `native` Web preset and flip only the preset roster default.** It would change the roster, locales, and UI for a setting that the executor row already expresses, and it would leave headless and SDK on native.

**Make PTC the default per model or provider.** No per-model tool-set selection exists, and adding one for a global default is a second configuration axis with no evidence that a provider needs it.

**Remove the native row.** Existing overlays such as `ptc.yml` and the 38 snapshot patches state both row ids, and the opt-out needs the row.

**Run programs unconfined when confinement is unavailable.** Programs import `node:fs` and `node:child_process`, so an unconfined worker would hand the model a wider boundary than native execution ever gave it; falling back to direct tools keeps the fail-closed shell.

**Probe confinement at startup.** The Windows runner is a sole candidate selected without a probe and refuses only when it executes, so a startup probe cannot see the failure; the first run reports it.

**Re-record every snapshot under PTC.** Recording needs a provider key and fixtures replay only on macOS and Linux; the existing `ptc-*` scenarios already cover the PTC path.

## Consequences

On a host without confinement the first `run_code` of the process fails and costs one model step before tools appear directly. Default model requests carry one `run_code` schema plus the `tools:ptc-only` guidance instead of per-tool schemas, and direct calls to any other tool name return `UNKNOWN_TOOL`. Deployments that scripted direct tool calls must opt out with the native overlay, as the [upgrade guide](../../../../docs/upgrade-guide/v0.2.2-rc.3/ptc-default/guide.md) describes. The pinned test infrastructure means the default composition's PTC path is covered by the dedicated `ptc-*` scenarios and the executor-default spec, not by the generic snapshots.

## Testing

`packages/bundle/web-app/tests/tool-executor-default.spec.ts` composes each bundle and overlay and asserts which executor rows and the PTC runtime are enabled: PTC for base, headless, SDK app, and web app; native with `native.yml`; native again after `native.yml` then `ptc.yml` flips back; native for `acp-app`; native without a runtime for `sdk-minimal`; no executor or `tool-presentation` row in the inheriting presets, and the `ptc` and `economy` presets selecting PTC themselves. `packages/core/tool-executor-ptc/tests/ptc.spec.ts` pins the unconfined-host fallback (every tool callable directly after `sandbox-unavailable`, code mode kept after ordinary failures), `packages/ptc-runtime/ptc-runtime-node/tests/host-failures.spec.ts` pins that runner-shaped stderr after readiness reports `worker-exit`, `packages/llm/llm/tests/content.spec.ts` pins that both tool-update modes handle one lone `run_code` replaced by twenty direct tools in a single update, and `packages/experimental/cua/tests/run-code-composition.spec.ts` runs a nested `cua_run_code` through the PTC executor.

# Agent Note: pi-ai 模型的可选请求模式

Status: implemented

[English](2026-09-25-pi-ai-request-modes.md) | 中文

## Problem

Codex fast mode 会更改模型请求的服务层级，同时保留提供方模型 id。可选择模式需要在 harness 中拥有独立模型 id，又不能把这个别名发送给提供方。

## Decision

`packages/llm/llm-pi-ai/src/catalog.ts:PiAiModelProfile` 中的 `PiAiModelProfile.modes` 会将每个模式展开为 `<id>-<mode>`，并继承解析后的模型。`RouteCatalog.modeRequests` 将可选 id 映射到提供方模型 id 与服务层级。`PiAiAdapter.streamWithSnapshot` 会为 pi-ai 恢复提供方 id，并通过 Responses API 保留的 `onPayload` 设置 `service_tier`；解析时会拒绝空服务层级、冲突 id 以及其他协议。harness 将所选别名保留为会话模型 id，因此无需修改会话类型或 SDK 投影。

pi-ai 的 Responses 实现通过 `buildBaseOptions` 接收 `SimpleStreamOptions`；该构建器保留 `onPayload`，但会省略 `serviceTier`，因此载荷钩子负责传递这个未建模的请求字段。

## Verification

`packages/llm/llm-pi-ai/tests/catalog.spec.ts` 覆盖 Codex `modelOverrides`、模式继承、协议与值拒绝、id 冲突以及延迟加载时的重复项清理。`packages/llm/llm-pi-ai/tests/adapter.spec.ts` 检查模式请求中的提供方模型 id 与服务层级，以及基础模型请求不带服务层级。适配器检查通过模拟端点验证请求序列化。

## Alternatives considered

**将服务层级加入 `ModelSelection` 与其会话事件。** 这会为了一个提供方请求选项而扩展持久化选择及其 SDK 投影；目录条目可在现有会话模型 id 下承载该选择。

**传递 pi-ai 的 `serviceTier` 流选项。** Responses 请求构建前，共享简单选项构建器会丢弃该字段，但会保留 `onPayload`。

## Consequences

模式 id 是持久会话中的模型 id。删除配置模式后，该 id 不再用于新请求，而现有会话仍保留历史选择。

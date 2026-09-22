# Agent Note：pi-ai 目录中的模型请求模式

Status: implemented

[English](2026-09-21-model-request-modes.md) | 中文

## 问题

Codex 的 fast 模式是同一模型上的服务层级，而不是另一个模型：CLI 在 `~/.codex/config.toml` 中切换 `service_tier = "fast"`，其模型目录为每个模型声明 `additional_speed_tiers: ["fast"]`，请求携带 `service_tier: "fast"`。harness 路由目前无法表达这一点——pi-ai 的 `Model` 没有层级字段，`ModelSelection` 也只携带 provider、model 与 reasoning effort——因此选择器没有任何方式请求它。

OpenChamber 底层的引擎 OpenCode 在目录而非选择类型中解决该问题：模型的 `experimental.modes` 条目（`{ fast: { provider: { body: { service_tier: "priority" } } } }`）会展开成一个额外模型，其 id 为 `<id>-<mode>`、名称为 `<Name> Fast`，并携带该模式的请求选项。在那里，reasoning effort 与服务层级都是逐模型的请求事实，而不是选择记录的字段。

## 决策

`dsh-llm-pi-ai` 的模型条目与 `modelOverrides` 值接受 `modes`，即具名请求模式的字典。每个模式解析为一个额外的目录条目——id 为 `<id>-<mode>`，名称为 `<name> <Mode>`，可用 `name` 覆盖——并继承所解析模型的协议、容量、模态、推理与兼容开关。模式的 `serviceTier` 记录在目录旁的 `RouteCatalog.modeRequests` 中，而不是记录在 `Model` 上，因为 pi-ai 的 `Model.id` 既是 harness 的键，也是提供方的模型名：该条目需要自己的键以供选择器和会话日志使用，而提供方仍必须收到它所扩展的模型。

模式在不携带 service tier 请求选项的协议上会被拒绝（`openai-codex-responses`、`openai-responses`），在模式名为空、`serviceTier` 为空、或 id 已被其他条目占用时同样会被拒绝。

tier 通过 pi-ai 的 `onPayload` 钩子而非其 `serviceTier` 选项抵达请求。两个 Responses 实现都会在 `streamSimple` 内依据 `buildBaseOptions` 的固定字段列表重建流选项，因此该选项无法穿过本适配器分派所用的入口，而 `onPayload` 可以——它正是 pi-ai 为自身未建模的请求字段提供的钩子。pi-ai 的 service tier 成本乘数由该选项决定，因此该乘数不生效；`TokenUsage` 不携带价格，也没有任何消费者读取价格。

选择某个模式不会改变 `ModelSelection`：会话记录该模式的模型 id，选择器像渲染任何其他行一样渲染它，且没有任何会话事件、投影、SDK 或 ACP 类型发生变化。关于负责固定版本所缺模型数据的同类机制，见 [Curated pi-ai catalog supplement](2026-09-18-pi-ai-catalog-supplement.zh.md)；关于本适配器携带的另一个源自 OpenCode 的传输事实，见 [OpenCode session header](2026-09-18-opencode-session-header.zh.md)。

## 验证

- `packages/llm/llm-pi-ai/tests/catalog.spec.ts` 断言展开后的 id 与名称、对容量、模态与推理的继承、显式声明的 `name`，以及在不支持的协议、为空的 tier 或模式名、以及冲突 id 上的拒绝。
- `packages/llm/llm-pi-ai/tests/adapter.spec.ts` 断言协议请求体：模式条目发送的 `model` 是它所扩展的模型且设置了 `service_tier`，而其基础模型两者都不发送。
- 无 keyless 录制会话快照变化：改变的是所提供的目录，而不是请求、转录或持久化内容。

## 考虑过的替代方案

| 被否决 | 原因 |
|---|---|
| 在 `ModelSelection`、请求头、`model/selection` 事件与 `modelSelection` 投影中加入服务层级字段 | 一个持久化选择维度要付出投影版本号提升、两个 SDK 投影、ACP 配置项与子代理工具 schema 的代价，只为承载一个提供方的层级；目录条目以零代价承载同一事实 |
| 传递 pi-ai 的 `serviceTier` 流选项 | 两个 Responses 的 `streamSimple` 在依据 `buildBaseOptions` 重建选项时都会丢弃它，因此它看起来已生效却什么也不发送 |
| 通过 `models.stream()` 而非 `streamSimple()` 分派模式请求 | `stream()` 接受协议专属选项，harness 因此要重新实现 pi-ai 逐协议的 thinking 等级与预算换算——而这正是 `streamSimple` 所拥有的行为 |
| 将 fast 模式作为目录补充项提供 | 补充项负责固定 pi-ai 版本所缺的模型数据；模式是部署对层级拼写的选择，而提供方自己的目录才是声明该能力之处 |

## 后果

- 路由只需一个配置条目即可为同一模型同时提供 fast 与标准两行，选择器、子代理模型列表与设置界面无需改动即可显示两者。
- 会话记录的是模式 id，因此日后移除某个模式会让历史会话点名路由不再提供的模型。
- 模式按模型声明；新增模型的路由不会从同级模型的声明中继承任何内容。

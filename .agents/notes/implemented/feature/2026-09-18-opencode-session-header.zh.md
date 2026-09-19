# Agent Note: pi-ai 路由的 OpenCode 会话头部

Status: implemented

[English](2026-09-18-opencode-session-header.md) | 中文

## 问题

OpenCode Go 要求每个模型请求都通过 `x-opencode-session` 携带稳定的对话身份，以便其网关能够路由该请求并保持提示词缓存一致；缺少该头部的请求会在推理（inference）开始前以 400 `MissingSessionID` 失败。harness 经 `dsh-llm-pi-ai` 触达 OpenCode 路由，而 `@earendil-works/pi-ai`（0.85.1，npm `latest`）从不发出该头部：它的 `sessionId` 选项只产生提供方原生的缓存亲和性字段，且 `sendSessionAffinityHeaders` 对 OpenCode 路由默认关闭。提供方所要的值早已以 `GenerateOptions.sessionId` 的形式存在于请求上，由 agent loop（智能体循环）在普通、标题生成与压缩（compaction）调用上打上持久化 `Session.id`，但没有任何适配器把它映射到 OpenCode 文档化的头部，因此 OpenCode Go 无法从 harness 使用。

## 决策

`dsh-llm-pi-ai` 在任何已解析出的 pi-ai 模型属于 OpenCode 网关的模型请求上，从 `GenerateOptions.sessionId` 设置 `x-opencode-session`。当模型的 pi-ai 提供方 id 为 `opencode` 或 `opencode-go`，或模型的请求 base URL 包含 `opencode.ai` 时，该路由即属于 OpenCode 网关。该检查在适配器选定线路 API 之前运行，因此 `openai-completions`、`openai-responses` 与 `anthropic-messages` 模型都会携带它。没有会话 id 的请求不发送该头部，因为没有可供命名的对话身份。

该头部是模型不可见的传输元数据。它的值绝不进入请求体、系统提示词、token 计量、KV Cache 身份或会话日志，它也不是会话事件。它与来自[强制应用归属头部](../architecture/2026-06-21-mandatory-app-attribution-headers.zh.md)的共享 `User-Agent` 并列，并遵循与 [DeepSeek 请求用户与会话身份头部](2026-08-11-deepseek-request-user-id-header.zh.md)中的提供方特有身份头部相同的隐私边界。

## 验证

- `dsh-llm-pi-ai` 的线路测试在 `opencode-go` 路由上发送精确的会话 id，并断言普通路由上不存在该头部；测试通过本地 HTTP 服务器，使用适配器真实的 profile 与模型解析。
- 该头部对模型不可见，因此没有无密钥录制会话快照发生变化。

## 考虑过的替代方案

| 已否决 | 原因 |
|---|---|
| 通过 profile 的 `headers` 字典设置固定的 `x-opencode-session` 值 | 固定值无法承载对话身份，因此所有对话都会共用同一条路由与缓存通道；部署无法推导当前会话 id，而它由所属运行时约定拥有 |
| 依赖 pi-ai 的 `sessionId` 选项或启用 `sendSessionAffinityHeaders` | pi-ai 0.85.1 只发出 `session_id`、`x-client-request-id` 与 `x-session-affinity`；没有一个是 OpenCode 指定的头部，且该选项是提供方原生的缓存亲和性，而非 OpenCode 的路由约定 |
| 把该值加入提供方无关的 `attributionHeaders()` 辅助函数 | 该辅助函数是静态应用身份；把逐对话值放进其中会使其到达无关提供方，并违反其用途 |
| 在 Host 服务或浏览器 UI 中设置该头部 | 该头部属于每个模型请求，而适配器是唯一同时拥有已解析提供方、模型与会话 id 的层 |
| 给 vendored 或已安装的 pi-ai 提供方打补丁 | 该提供方并未 vendor 到本仓库，而为一个头部固定某个 fork 会重复 harness 自身的适配器约定；适配器本就拥有逐请求的传输元数据 |

## 后果

- OpenCode Go 请求现在携带持久化对话 id，在每条模型路径上满足提供方的路由与提示词缓存要求。
- 该头部不改变请求体、提示词、token 数、KV Cache 前缀或会话日志；没有快照发生变化。
- base URL 包含 `opencode.ai` 的自定义路由会被视为 OpenCode 网关并收到该头部；指向非 OpenCode 端点的路由不受影响。
- 该映射以 `GenerateOptions.sessionId` 为条件；不携带会话 id 的调用仍然不发送任何内容，因此今后必须触达 OpenCode Go 的调用方需要提供会话 id。

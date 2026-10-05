---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-04-jev-decision-applied-route

[English](2026-10-04-jev-decision-applied-route.md) | 中文

## 概述

`jev/decision` 事件新增两个可选属性：`route`，即路由器实际应用的路由 ID，也就是 Jev 的选择，或在 Jev 把握不足时使用的回退路由；以及 `rejected`，标记路由器停止该轮而不是保留聊天模型。两者都是可选的事件体属性，因此属于同版本更改。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-04-jev-decision-applied-route
baseline: false
changes:
  - root: "event:jev/decision"
    previous: "2026-10-03-hook-overrides-and-jev-decisions"
    after: "96bc55e52033bf9462b9aa0df7f3f2f48ff8965804e638edfc54064afe8a2f1f"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

现有 `jev/decision` 记录仍然有效。在 `route` 出现之前写入的记录不含该属性，其中的 `provider`/`model` 可能记录实际运行的回退路由，而 `choice` 是 Jev 提出但被路由器否决的选择，因此读取方不得把缺失的 `route` 当作实际应用的路由 ID。在 `rejected` 出现之前写入的记录不含该属性，缺失表示路由器保留了聊天模型，这正是那些记录的写入方式。该事件仅写入日志，从不进入模型历史，因此忽略这两个属性的旧读取器重放会话的结果不变。

<a id="verification"></a>
## 验证

pnpm exec vitest run packages/llm/llm-jev-router 通过 52 个测试，包括路由器在 fail closed 时停止轮次的记录。pnpm exec vitest run packages/client/ui-model-selection 以 100% 覆盖率通过 78 个测试，包括停止轮次与旧版回退的文案。重新生成后 `pnpm run verify-persistence-catalog` 通过。

<a id="dev-note"></a>
## 开发备注

无。

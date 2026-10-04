---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-04-jev-decision-applied-route

[English](2026-10-04-jev-decision-applied-route.md) | 中文

## 概述

`jev/decision` 事件新增可选属性 `route`：路由器实际应用的路由 ID，即 Jev 的选择，或在 Jev 把握不足时使用的回退路由。该更改新增可选的事件体属性，因此属于同版本更改。

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
    after: "67e3254d4c1681544ea248f66723bc83de41f0dfae84598b91b1bc46838fe663"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

现有 `jev/decision` 记录不含 `route`，仍然有效；`jevDecision` 投影与输入框路由面板会把缺失的 `route` 视为 Jev 自己的选择，这正是这些记录的写入方式。该事件仅写入日志，从不进入模型历史，因此忽略该属性的旧读取器重放会话的结果不变。

<a id="verification"></a>
## 验证

`pnpm exec vitest run packages/llm/llm-jev-router` 通过 49 个测试，包括有把握的选择、回退路由和保留聊天模型的记录。`pnpm exec vitest run packages/client/ui-model-selection` 以 100% 覆盖率通过 72 个测试，包括回退说明。重新生成后 `pnpm run verify-persistence-catalog` 通过。

<a id="dev-note"></a>
## 开发备注

无。

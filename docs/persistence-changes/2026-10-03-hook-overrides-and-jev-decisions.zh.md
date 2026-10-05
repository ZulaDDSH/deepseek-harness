---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-03-hook-overrides-and-jev-decisions

[English](2026-10-03-hook-overrides-and-jev-decisions.md) | 中文

## 概述

添加两个仅写入日志的 Session 事件：hooks/session-overrides 记录完整的按会话钩子启用/禁用映射，jev/decision 记录每次 Jev 路由结果（选择、置信度、应用的路由或错误）。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-03-hook-overrides-and-jev-decisions
baseline: false
changes:
  - root: "event:hooks/session-overrides"
    previous: null
    after: "8f1df624af4d2a5d9aa39342beb3d354c8147388e80ba7a0cf9b6aa7d1cb0f5e"
    decision: same-version
  - root: "event:jev/decision"
    previous: null
    after: "06f9dc0f3520fd54d8bb07d330acf0d089e87898429952c991c18803eddaf7f8"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

现有事件结构和 Session 代际不变。两个事件都不会进入模型历史。没有 hooks/session-overrides 的会话使用各桥接器的 enabledHooks 设置；没有 jev/decision 的会话行为与之前相同。两个事件在读取时都是必需的：无法识别它们的旧版本会拒绝受影响的日志，而不是静默丢弃这些记录。

<a id="verification"></a>
## 验证

pnpm exec vitest run packages/llm/llm-jev-router packages/api/session-controller packages/client/ui-conversation：Jev 路由每轮记录一次决定（包括失败），会话钩子弹窗通过 setHookOverrides 写入覆盖。

<a id="dev-note"></a>
## 开发备注

无。

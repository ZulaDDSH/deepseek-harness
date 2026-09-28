---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-09-27-mcp-connector-selection

[English](2026-09-27-mcp-connector-selection.md) | 中文

## 概述

添加 mcp/selection Session 事件，记录所选 connectorIds。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-09-27-mcp-connector-selection
baseline: false
changes:
  - root: "event:mcp/selection"
    previous: null
    after: "1ccb7116650e66089c8d2958f212e08a2311cdd8db1978f9d8fe05509032ecac"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

已有事件模式和 Session 代际保持不变。没有 mcp/selection 的 Session 保留原有连接器默认行为。新事件读取时必须被识别：不识别该事件的旧版本会拒绝受影响的日志，而不会静默丢弃选择。

<a id="verification"></a>
## 验证

pnpm exec vitest run packages/api/session-controller/tests/mcp-selection.host.spec.ts：两个测试通过，覆盖未注入 tools 属性时的控制器安装和所选连接器限制。

<a id="dev-note"></a>
## 开发备注

无。

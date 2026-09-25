---
description: "Host Remote 服务，为浏览器客户端提供基于凭据的提供商配额与余额读取。"
kind: "package-reference"
---

# @deepseek-ai/dsh-api-quota-controller

[English](README.md) | 中文

## 概述

当浏览器界面需要标准化的提供商配额或余额数据、但不应接收凭据值时，请使用本包。它通过 `quota` Remote namespace 暴露已配置的提供商，在 Host 上解析凭据，按提供商合并并发读取，并且只返回客户端安全的用量字段。内置注册表支持 DeepSeek 余额与 OpenCode Go 配额窗口，也可由 Host 组合扩展。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

把本包挂载到同时提供 `ctx.credentials` 与 Remote gateway 的 Host 组合中。`listProviders()` 只报告凭据当前可解析的提供商，而 `fetch(providerId)` 返回标准化配额状态，绝不返回凭据本身。

内置提供商读取 DeepSeek 账户余额与 OpenCode Go 滚动配额窗口。部署代码可以通过 `QuotaControllerInternals` 提供额外的 `QuotaProvider` 条目。

-----

<a id="model-experience"></a>
## 模型体验

无，因为 Host 配额 API 只向浏览器客户端返回基于凭据的提供商用量，不注册提示词、工具或 Session 事件。

#### KV Cache 影响

无直接影响；配额读取发生在模型请求之外，不会改变可复用的模型请求前缀。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 提供商 API 按需查询，并且只标准化配额界面需要的字段；不暴露未支持的提供商字段。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布 invariant companion，因为该控制器不拥有跨包运行时断言契约。

---
description: "浏览器会话标题栏中的提供商配额弹窗，显示用量、重置窗口、余额与持久 Session token 总量。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-provider-quota

[English](README.md) | 中文

## 概述

使用本包可在会话标题栏显示提供商配额与 Session token 用量。它从 Host 的 `quota` Remote namespace 读取已配置提供商结果，呈现百分比窗口、余额、重置时间和提供商状态，并可显示当前 Session 的持久 token 总量。它只负责展示与刷新状态；提供商凭据和配额请求仍由 Host 持有。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

把客户端插件挂载到包含本包所声明 Remote、locale、conversation 与 renderer 依赖的 Web 组合中。插件会向 `conversation.session.header.utilities` 添加一个紧凑的用量控件，并通过 Host 服务刷新提供商配额。

弹窗只显示 Host 注册表返回的提供商。Session projection 数据可用时，它还会显示当前 Session 的持久 token 总量。

-----

<a id="model-experience"></a>
## 模型体验

无，因为浏览器侧配额展示只读取已有 Remote 与 token 用量状态，不注册面向模型的上下文。

#### KV Cache 影响

无直接影响；打开或刷新配额界面不会改变模型请求或可复用的请求前缀。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 只显示 Host 配额注册表返回的提供商；不会从模型设置中推断未支持的提供商。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布 invariant companion，因为这个浏览器展示包不拥有跨包运行时断言契约。

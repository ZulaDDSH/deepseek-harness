---
description: "DeepSeek Harness 的可选 TypeSafe Jev 决策路由与凭据设置。"
kind: "package-reference"
---

# @deepseek-ai/dsh-llm-jev-router

[English](README.md) | 中文

## 概述

当 Agent 步骤需要让 TypeSafe Jev 从显式允许的 DSH provider/model 路由中做选择时使用本包。插件默认关闭；关闭时，或 fail-open 处理接受 Jev 失败时，会保留已有路由。API 密钥通过 DSH 凭据服务保存，而不是写进 settings 文本。Jev 始终是独立的决策请求，不会变成普通 DSH 模型 provider。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在 base composition 中挂载插件。打开 **设置 → 模型 → TypeSafe / Jev** 并输入密钥。编辑器会将其保存到 `TYPESAFE_API_KEY` 凭据引用；无界面部署可以通过启动环境提供该引用。

### 最小配置

```yaml
- name: '@deepseek-ai/dsh-llm-jev-router'
  config:
    enabled: true
    apiKeyEnv: TYPESAFE_API_KEY
    routes:
      - id: lean
        provider: claude-code
        model: claude-sonnet
        description: Short, routine, low-risk tasks
      - id: powerful
        provider: claude-code
        model: claude-opus
        description: Complex architecture, debugging, or multi-step tasks
```

模型页面通过凭据服务写入密钥，不会把密钥放入该配置。`fallback: keep` 在 Jev 不确定或不可用时保留原始路由；`failOpen: false` 则拒绝该步骤。

-----

<a id="model-experience"></a>
## 模型体验

### Jev 路由请求

#### 模型看到的内容

独立 Jev 请求会接收从已准入用户消息派生的有界状态，以及配置的路由选择和描述。被选中的 DSH provider/model 仍接收自己的正常请求；Jev 的响应本身不会追加到该模型的提示词中。

#### Token 影响

路由启用且被准入时，本包会使用受 `stateMaxChars` 限制的状态和路由选择 payload 创建一次独立 TypeSafe Jev 请求。除了所选 provider 原本会收到的内容外，它不会向该 DSH provider 请求添加提示词 token。

#### KV Cache 影响

Jev 请求与所选 DSH provider 请求拥有独立的缓存生命周期。修改 Jev 状态、路由、endpoint 或模型会改变该决策请求，但本包不会重写所选 provider 可复用的提示词前缀。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 路由描述与 provider/model 标识由配置负责，并且必须匹配当前 DSH composition 中可用的路由；插件不会自动发现或添加缺失路由。
- Fail-open 行为在 Jev 失败时保留基础路由，因此要求路由必须成功的部署需要显式设置 `failOpen: false`。
- 会话上已存储的模型选择具有权威性：当解析出的路由来自该选择时，Jev 的建议会被丢弃而不是被应用。没有 `sessionProjections` 服务的 composition 不存在可遵循的已存储选择，会直接路由组装出的默认路由。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

HTTP API 使用 `https://api.typesafe.ai/v1/systemone` 和 `jev-latest` 模型。凭据必须保存在 DSH 凭据服务或启动环境中，不能放入源码、YAML、日志或 pull request。

</details>

**运行时不变式：** 不发布 invariant companion，因为本包的运行时检查由针对性路由验证和请求路径测试负责。

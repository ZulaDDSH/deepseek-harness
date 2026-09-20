---
description: "DeepSeek Harness 的可选 TypeSafe Jev 决策路由与凭据设置。"
kind: "package-reference"
---

# @deepseek-ai/dsh-llm-jev-router

[English](README.md) | 中文

## Summary

`@deepseek-ai/dsh-llm-jev-router` 可选调用 TypeSafe Jev，为每个 Agent 步骤从允许列表中选择 DSH provider/model。插件默认关闭；Jev 不可用或关闭时会保持现有 provider 选择，并通过 DSH 凭据服务保存 API 密钥，而不是写入设置文本。

## Table of Contents

- [使用此包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制和后续工作](#known-limitations-and-deferred-work)
- [开发者说明](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

在 base composition 中加载插件。打开 **设置 → 模型 → TypeSafe / Jev** 并输入密钥。编辑器会将其保存到 `TYPESAFE_API_KEY` 凭据引用；无界面部署可以通过启动环境提供该引用。

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

模型页面会通过凭据服务写入密钥，不会把密钥放入该配置。`fallback: keep` 会在 Jev 不确定或不可用时保留原始路由；`failOpen: false` 则会拒绝该步骤。

-----

<a id="model-experience"></a>
## 模型体验

Jev 会接收已准入用户消息的有界状态，返回带置信度的类型化 Choice，选中的路由随后在 Agent request waterfall 中应用。同一个 Agent turn 和 step 的重试会复用该决策。Jev 是决策层而非 LLM provider，因此不会出现在普通模型目录中。

-----

<a id="known-limitations-and-deferred-work"></a>
## 已知限制和后续工作

路由描述与 provider/model 标识由配置负责，必须匹配当前 DSH composition 中可用的路由。插件默认 fail-open，不会自动向 allowlist 添加 provider 或模型。

-----

<a id="dev-note"></a>
## 开发者说明

HTTP API 使用 `https://api.typesafe.ai/v1/systemone` 和 `jev-latest` 模型。凭据必须保存在 DSH 凭据服务或启动环境中，不能放入源码、YAML、日志或 pull request。

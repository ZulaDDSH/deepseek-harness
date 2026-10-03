---
description: "共享知识策略与 Git 来源包。"
kind: "package-group"
---

# knowledge/ — 共享知识

[English](README.md) | 中文

## 概要

knowledge 组将共享知识策略加入系统提示词，并从配置的 Git 仓库读取知识记录。检索按需提供记录；策略包不会把记录内容注入模型请求。

## 包

| 包 | 职责 |
|---|---|
| [`knowledge-policy`](knowledge-policy/README.md) | 注册共享知识系统提示词段落。 |
| [`knowledge-source-git`](knowledge-source-git/README.md) | 读取和搜索 Git 支持的知识记录。 |
| [knowledge-router](knowledge-router/README.zh.md) | 将有界查询路由到配置的 MCP 提供方。 |

## 相关文档

- [系统提示词子系统](../../docs/subsystems/system-prompt.zh.md)

## 开发备注

各包 README 说明其配置和运行行为。

---
description: "有界 GitNexus 和 Graphify 检索及显式学习写入。"
kind: "package-reference"
---

# @deepseek-ai/dsh-knowledge-router

[English](README.md) | 中文

## 概述

从已配置的 GitNexus 和 Graphify MCP 服务检索有界知识。手动模式提供检索；辅助模式还会携带检索包委派任务。提供方和学习写入需要显式启用。Memorix 保持为独立的 MCP 集成。

## 目录

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

在已配置的 MCP 客户端之后挂载路由器。

### When to choose it

需要有界代码查询或先前结论时使用路由器。

### Minimal configuration

```yaml
- name: '@deepseek-ai/dsh-knowledge-router'
  config:
    mode: manual
    gitnexus: { enabled: true, serverName: gitnexus }
```

| Field | Default | Meaning |
|---|---|---|
| `mode` | `off` | 启用手动检索或辅助委派。 |
| `gitnexus.enabled` / `graphify.enabled` | `false` | 允许检索该提供方。 |
| `maxPacketBytes` | `4096` | 按 UTF-8 字节限制检索包。 |
| `learning.enabled` | `false` | 注册主管学习写入。 |

[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-knowledge-router)列出所有字段。[可选覆盖配置](../../../apps/cli/config/examples/knowledge/graphify-gitnexus.cordis.yml)需要单独安装提供方命令。

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

嵌套提供方调用保留所属执行关系。辅助子任务遵守子代理服务的深度限制。学习拒绝被委派的子任务，将验证者身份附加到保存的答案，并在保存成功后单独报告反思失败。

| Source | Responsibility |
|---|---|
| [src/index.ts](src/index.ts) | 配置、检索和委派。 |
| [src/packet.ts](src/packet.ts) | 渲染和字节限制。 |
| [src/graphify-learn.ts](src/graphify-learn.ts) | 学习和新鲜度命令。 |

不发布运行时不变量配套入口：检索包来自注册表和提供方结果，没有独立维护的状态。

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Knowledge packages](../README.zh.md)
- [MCP client](../../mcp/mcp-client/README.zh.md)
- [Tools subsystem](../../../docs/subsystems/tools.zh.md)

-----

<a id="model-experience"></a>
## Model Experience

### Tools

#### What the model sees

`knowledge_query` 检索有界包。`knowledge_delegate` 使用检索包或原始任务启动可继续的子任务。禁用和断开连接的提供方不可用。可选 `knowledge_record` 保存结论；`reflectionError` 单独报告保存成功后的反思失败。

#### Token effect

启用的工具将模式加入请求，将记录结果加入对话。不添加系统提示文本。

#### KV Cache effect

模式和学习设置的变化会改变工具定义前缀。结果在可复用前缀后扩展对话。

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

提供方和数据由部署管理。

- 不捆绑提供方可执行文件。命令不可用时跳过真实提供方测试；夹具独立验证路由器。
- Graphify 学习运行文件系统沙箱之外的已配置主机命令。仅为可信提供方和内存位置启用。
- Auto 权限审查不支持通用的嵌套提供方调度；这些调用会拒绝执行。
- 缺少提供方新鲜度时保持 `unknown`。自定义 Graphify 记忆目录的课程新鲜度保持未知，因为 `explain` 不支持选择该目录。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

---
description: "本地 Memorix 浏览、文档导入和 Graphify 上下文图谱。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-memory-workspace

[English](README.md) | 中文

## 概述

侧栏中的记忆面板浏览本地 Memorix 存储，通过已连接的提供方导入文档，并显示 Graphify 自己生成的 HTML 查看器。默认 Web 组合中禁用此面板，需要显式启用。

## 目录

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

## Use this package

在已配置的 Memorix MCP 客户端旁启用 `ui-memory-workspace` 行。`memorixServer` 默认为 `memorix`。浏览时使用客户端显式配置的 `MEMORIX_DATA_DIR`，否则使用 Memorix 默认的 `~/.memorix/data`。`databasePath` 可覆盖此路径；远程 MCP 提供方必须显式指定本地路径。

选择 **Memory**，浏览提供方的所有表、搜索所有列并检查完整记录。本地视图包含所有项目、状态和可见范围，不会将这些记录转发给模型。上传 TXT、Markdown、CSV、JSON、日志、PDF 或 Office 文档时，保留原始文件，并通过 `memorix_store` 写入每个提取文本片段。每个片段都按提供方确认的观察记录标识与项目从数据库重新读取后才报告成功。部分导入保留已完成的片段，并可使用稳定文档标识重试。

**Context graph** 标签页每次打开或刷新时，从已连接的 Memorix 数据库重建完整且有效的文档导入。将 `graphifyCommand` 配置为 Graphify 的 Python 解释器，并在 `graphifyArgs` 中指定 `scripts/graphify-native.py`。适配器还原保存的文本，调用 Graphify 自带的 Markdown 提取器、构建器、社区检测器、结构标签与 HTML 导出器，不调用模型或扫描 Harness 代码。标题与明确链接属于结构证据，不进行概念推断。部分导入与归档导入被排除。输出使用 `graphPath`，否则使用 `importDirectory` 下的 `graphify-out/graph.json`。原生查看器在仅允许脚本的沙箱中保留社区筛选、布局、搜索与节点详情；固定版本的可视化库从 unpkg 加载。旧版已安装的 Host 可在适配器参数中加入 `--memorix-database <database>` 前缀，然后运行 HTML 导出命令。知识路由器的 `/graphify` 命令继续使用当前聊天工作目录的图谱。

-----

## Understand the implementation

`src/index.ts:MemoryWorkspace` 负责经过身份验证的 Host RPC 方法、上传内容保留和经提供方确认的导入。`src/client/MemoryPage.tsx:MemoryPage` 负责浏览与图谱交互。[知识路由器](../../knowledge/knowledge-router/README.zh.md)负责只读 SQLite 访问与原生 Graphify 聊天命令。[MCP 客户端](../../mcp/mcp-client/README.zh.md)负责对当前已连接提供方的用户操作访问，访问随插件作用域释放。

不发布运行时不变量配套入口：显示数据来自提供方读取，不维护独立的记忆索引。

-----

## Further Exploration

- [记忆 MCP 配置](../../../docs/user/guide/mcp-memory.zh.md)
- [客户端包](../README.zh.md)

## Model Experience

### 文档导入工具

#### 模型所见

挂载工具注册表与文件系统后，智能体可调用 `memorix_import_file`，传入绝对路径或相对于聊天工作目录的路径。此工具与面板共用有大小限制且经提供方验证的导入器，返回保留文件的路径、片段计数与部分失败。示例请求：“使用 memorix_import_file 将 docs/guide.pdf 导入 Memorix。”现有 Memorix 工具可检索导入的记忆；面板不自动注入记忆。

#### Token 影响

工具 schema 和经提供方确认的导入结果占用请求及对话 token。导入文档的内容不会自动注入后续请求。

#### KV 缓存影响

Memorix 提供方配置负责后续检索及其请求影响。

## Known Limitations and Deferred Work

- 仅支持 Memorix 1.3.0 的迁移清单；不支持的数据库会明确失败，绝不会迁移。上传支持 UTF-8 文本、PDF 文本层与现有 Office 转换提供方支持的文档。扫描文档需要 OCR；此面板不执行 OCR。超过字节或提取字符限制的文档会被拒绝，不会截断。
- 必须安装 Graphify 与所提供的适配器。派生图谱在打开或刷新时重建；后续图谱生成失败不会影响已成功的上传。本地浏览包含本地用户拥有的个人与团队记录，适用于经过身份验证的个人 Host。

<a id="dev-note"></a>
### 开发备注

无。

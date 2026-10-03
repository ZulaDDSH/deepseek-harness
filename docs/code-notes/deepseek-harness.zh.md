# DeepSeek Harness 代码备注

`scripts/project-doc-site.spec.ts:publishableImage` 通过目录链接测试外部图片拒绝路径。Windows 使用 junction，使负向用例不依赖文件符号链接权限。

`packages/client/ui-conversation/src/client/apply.ts:apply` 通过现有命令注册表提供桌面文件夹与 Session 连接器菜单操作。文件夹选择保留原 Session binding，并使用现有引用语法。`packages/api/session-controller/src/agent.ts:ApiSessionAgentController.installMcpSelection` 在工具注册表变更时刷新继承工具限制，从 schema 和服务器段落中移除禁用的命名空间，并根据请求的服务器限制共享资源工具。`packages/client/ui-plugin-manager/src/client/index.ts:apply` 在 Session 命令菜单中提供 profile 管理导航。

[English](deepseek-harness.md) | 中文

## 工作流仓库定位

`.github/issue-management/github.mjs:repositoryTarget` 在存在 `DSH_ISSUE_REPOSITORY` 时将 GitHub API 请求定位到启动工作流的仓库；本地策略测试仍使用规范项目回退值。自动化拉取请求不需要 Project 生命周期处理或 Cloudflare 预览，因此相应工作流会跳过机器人作者的拉取请求。

引用：`.github/workflows/ci.yml:node` 和 `scripts/ci-workflow.spec.ts:workflow`。拉取请求的 Linux 和 Windows 工作流默认使用标准 GitHub 托管运行器；`DSH_CI_FAILOVER_LINUX`、`DSH_CI_FAILOVER_WINDOWS` 以及明确指定的 Blacksmith 或 self-hosted 值仍保留为可选替代方案。

引用：`packages/api/settings-controller/src/request.ts:settingsRequest.parse`。授权与凭据请求校验共用一个解析器，因此重复检测门禁不会接受同一线路错误映射的两份副本。

## Jev 路由

`packages/llm/llm-jev-router/src/index.ts:apply`：Jev 是一个决策端点，而不是 LLM 适配器。该插件在 `agent/pre-step` 中对已接纳的 agent 步骤消息进行分类，为重试缓存结果，并在 `agent/request` 中应用允许列表内的提供方／模型。它默认禁用，并按请求解析其 API 凭据。

`packages/llm/llm-jev-router/src/index.ts:Config`：`enabled` 控制启用；`apiKeyEnv` 是凭据引用；`endpoint` 与 `model` 选择 TypeSafe；`timeoutMs`、`minConfidence` 与 `stateMaxChars` 约束决策；`fallback` 与 `failOpen` 定义失败行为；`routes` 是提供方／模型允许列表。

`packages/llm/llm-jev-router/src/index.ts:JevRoute`：`id` 是 Jev 选项；`provider`、`model` 与可选的 `reasoningEffort` 是 DSH 目标；`description` 作为 Jev 选项判据发送。

## 模型选择优先级

`packages/core/agent/src/model-selection.ts:installModelSelection`：前置的 `agent/request` 监听器在下游解析器返回后应用已组装的选择。因此，即使路由器也前置其监听器，所选提供方、模型和推理力度仍然具有最终决定权。

## Client 类型边界

`packages/deliverables/workspace-changes/src/types.ts` 与 `packages/client/ui-deliverables/src/changes.ts`：Client 可达的代码从 `@deepseek-ai/dsh-workspace/types` 而不是包根导入 `WorkspaceId`。根入口会导入 `@deepseek-ai/dsh-session` 根，其 `Context.sessions: SessionStore` 增强与 `packages/api/session-controller/src/client/index.ts` 中的 Client `ISessions` 声明冲突。类型感知的 linter 会把项目引用的声明解析到源码，因此能看到这一传递增强（tsc 看不到），并把 `packages/client/ui-open-in-app/src/client/index.ts` 中的 `ctx.sessions` 报告为错误类型。

`packages/test-support/client-runtime/src/index.ts:SlotTestRuntime.mount` 声明为 `async`，使把它传给返回 promise 的插槽的调用方无需逐处包装即可满足 `no-misused-promises`。

## 投影清理

`packages/boot/app-boot/src/profile.ts:removeLinkProjections` 在删除真实容器目录之前，先解除直接及作用域投影 junction 的链接。Electron 44 搭载 Node 24.18.1，其递归删除遇到 Windows 循环 junction 时以 errno -4094 失败；构建宿主 Node 24.19.0 不会复现该故障。`packages/boot/app-boot/tests/profile.spec.ts:removeLinkProjections` 覆盖直接及作用域循环投影，并逐例解除链接以清理资源；回归验证使用已打包的 Electron 运行时。

## 模型用量显示

`packages/llm/llm-pi-ai/src/catalog.ts:catalogModels` 删除固定目录的最新标记并保留用户名称。`packages/client/ui-provider-quota/src/client/ProviderQuotaAction.module.css:.popover` 使用已定义的不透明浮层颜色。`packages/llm/token-meter/src/model-usage-projection.ts:modelUsageProjectionDefinition` 按实际路由分组持久报告用量，并复用结算和重试计数。`packages/llm/llm-pi-ai/src/codex-quota.ts:createCodexQuotaSource` 保持凭据刷新由提供商持有；`packages/api/quota-controller/src/index.ts:QuotaController.registerSource` 保持基于 effect 的注销。

`packages/llm/llm-pi-ai/src/codex-quota.ts:createCodexQuotaSource` 仅为已配置的账户读取创建模型集合。`packages/experimental/webworker-runtime/src/node/external_packages/pi-ai.ts:builtinModels` 拒绝 worker 不支持的认证操作。

`packages/client/ui-provider-quota/src/client/ProviderQuotaAction.tsx:sessionTokenLabel` 格式化必需的模型用量，由调用方处理缺失的会话用量。`.github/workflows/ci.yml:refresh-web-snapshots` 在 Linux 上运行选定的 Web 会话测试，并上传当前写入器的输出供审核。

`apps/web/tests/preview-boot.e2e.ts:respond` 先用 POSIX 分隔符规范化 URL 路径，再匹配生成的资源键；文件系统路径仍使用平台原生的连接方式。

## Memory workspace

`scripts/graphify-native.py:memorix_graph` 从只读 Memorix 快照还原完整且有效的文档导入，将文本交给 Graphify 的 Markdown 提取器、构建器、社区检测器与 HTML 导出器。部分导入被排除。图谱只包含已保存的文档；结构标题与明确引用不代表语义推断。`packages/client/ui-memory-workspace/src/index.ts:MemoryWorkspace.graph` 串行执行重建，在打开或刷新时重新生成派生视图；图谱失败不会撤销已保存的记忆。

`packages/knowledge/knowledge-router/src/memorix-types.ts` 包含平台无关的浏览器值；生成的 Client RPC 声明导入此叶模块，不加载 Host Agent 服务。

`packages/client/ui-memory-workspace/src/index.ts:MemoryWorkspace` 浏览已连接的 Memorix 存储，并通过当前提供方导入保留的文档。`packages/knowledge/knowledge-router/src/memorix-store.ts:memorixStoredChunk` 校验确认的观察记录与项目、主题和完整叙述。`packages/client/ui-memory-workspace/src/document-text.ts:documentText` 使用现有 PDF 与 Office 提供方提取文本；原始文件不会自动进入模型请求。`packages/mcp/mcp-client/src/human-operations.ts:registerHumanOperations` 提供随作用域释放的 Host 访问，只能调用已发现且通过过滤的工具，不使用 Agent 工具执行令牌。

`packages/client/ui-memory-workspace/src/index.ts:MemoryWorkspace.loadGraph` 调用已安装的 Graphify HTML 导出器；`src/client/MemoryPage.tsx:MemoryPage` 嵌入未修改的查看器，允许脚本而禁止同源访问。`packages/knowledge/knowledge-router/src/graphify-command.ts:registerGraphifyCommand` 从聊天工作目录调用同一配置的提供方。`scripts/graphify-native.py:run` 在同一 Python 进程调用 Graphify 的结构标签函数和官方 CLI，不实现图谱布局或聚类算法。

`packages/client/ui-chat/src/client/conversation-nodes/chat-snapshot-builder.ts:chatViewDefinition.isActive` 将非空斜杠命令结果文本计入可见会话活动，没有文本的命令保留起始布局。

`scripts/package-dependency-policy.ts:PEER_REQUIRED_HOST_EXPORTS` 使 Memorix 存储读取、Office 标识、主目录路径和原生命令执行使用共享的 Host peer 实例。`packages/client/ui-memory-workspace/tsconfig.client.json` 和 `packages/api/remotes/tsconfig.client.json` 使用生成的 Remote 声明，而不引用 Memory Host 项目。

`packages/client/ui-memory-workspace/src/index.ts:MemoryWorkspace` 使用现有工具注册表和文件系统注册 `memorix_import_file`。读取以调用方聊天工作目录为基准，遵循文件系统限制，并结合调用方取消与插件释放；面板与工具共用文档保留和提供方重新读取验证。`src/client/MemoryPage.module.css` 指定原生选项颜色和当前深色方案。包的 `./types` 导出参考 `ui-settings-general`，仅公开类型声明，不发布带 CSS 导入的原始 Client JavaScript。

`packages/hooks/hook-protocol/src/inventory.ts:HookInventoryReport`、`packages/hooks/hooks-codex/src/index.ts:apply`、`packages/hooks/hooks-claude-code/src/index.ts:apply`、`packages/host/plugin-inventory/src/index.ts:readPluginInventory` 和 `packages/client/ui-settings-plugin-inventory/src/client/HooksSettingsSection.tsx:HooksSettingsSection` 通过同步收集器发布已加载的钩子配置，设置页面会连同下文所述的启用控制一起列出。不会重新读取来源文件，销毁会移除报告，加载状态不表示命令已执行。

`packages/hooks/hook-protocol/src/inventory.ts:hookEnabled` 是两个桥接器（`runPoint`）和 `describeHookHandlers` 共用的唯一钩子启用规则。钩子的标识是替换后的 `hookKey` = `[event, matcher, command]`。会话覆盖优先；否则只有当桥接器的易变 `enabledHooks` 列出其键或包含 `ALL_HOOKS`（`'*'`）时钩子才会运行。默认拒绝意味着新增或修改的外部钩子会得到新键并保持关闭。通配符用于运维编写的组合，例如 `snapshots/session/text-turn/cordis.yml`；设置页面只写入明确的键。

`packages/client/ui-settings-plugin-inventory/src/client/HooksSettingsSection.tsx:HooksSettingsSection` 只列出带有 `settingsNs`（`ctx.fiber.entry.options.id`）的报告，只有已挂载的桥接器会设置它；来自 `packages/host/plugin-inventory/src/hook-files.ts:readHookFiles` 的外部文件报告（包括解析失败的）无法控制，因此会被隐藏。开关和描述通过 `remote.settings.mutate` 将 `enabledHooks` 和 `hookDescriptions` 写入该命名空间；Loader 的 `entry.id` 带有设置不接受的 `include/` 前缀。

`packages/client/ui-settings-plugin-inventory/src/client/HooksSettingsSection.tsx:hookName` 以最后一个 `/` 或 `\` 之后的脚本文件名称呼钩子，因此 `node "C:\hooks\check.mjs"` 这样的 Windows 命令显示为 `check`。`HooksSettingsSection` 直接把 `settingsNs` 用作写入命名空间：加载失败的桥接器不报告任何处理器（`packages/hooks/hooks-codex/src/index.ts:apply` 使 `parsed` 保持为空），因此没有已加载的桥接器就不会出现处理器行及其控件。

`packages/api/session-controller/src/hook-overrides-projection.ts:installHookOverridesProjection` 将仅写入日志的 `hooks/session-overrides` 事件折叠到 `hookOverrides` 投影中。`SessionController.listHooks` 和 `setHookOverrides` 为 `packages/client/ui-conversation/src/client/apply.ts` 中的输入框 `hooks` 弹窗提供服务。

`packages/client/ui-settings-models/src/client/ProviderEditor.tsx:ProviderEditor` 将 Jev 路由的提供方、模型和推理强度渲染为下拉选择，选项来自 Host 模型目录并合并各配置的 `models`；目录中缺失的已存值仍可选择，自定义选项则回退为自由文本。

`packages/llm/llm-jev-router/src/index.ts:apply` 每个用户轮次只决定一次并在该轮所有步骤中复用，失败会缓存为“无路由”，因此每轮最多调用一次 Jev。每个结果都记录为仅写入日志的 `jev/decision` 事件。`agent/request` 监听器在第一次启用的 `agent/pre-step` 时注册到 `agent.ctx` 上，从而包裹按会话的 `installModelSelection` 监听器；未路由的步骤会解析为 `modelSelection.selected`，否则为 `agent.options`，而不是沿用先前步骤持久化的路由。

`packages/boot/plugin-manager/src/mcp-servers.ts:discoverMcpServers` 读取 Claude Desktop、Claude Code（顶层和按项目的 `mcpServers`）以及 Codex（`config.toml` 的 `mcp_servers`）；由于 `dsh-mcp-client` 只支持 stdio 和可流式 HTTP，SSE 服务器会被跳过。`PluginManager.addMcpServer` 追加一个 id 为 `mcp-<serverName>` 的配置 `insert` 行，`removeMcpServer` 删除该插入行以及该 id 的所有直接行，启用状态复用 `setPluginEnabled`。

`packages/knowledge/knowledge-router/src/index.ts:KnowledgeRouter` 仅当 `config.graphify.cli.command` 是字符串时才注册 `/graphify`。`Config` 模式即使没有配置启动器也会把 `graphify.cli` 填充为 `{ args: [] }`，因此用 `cli !== undefined` 判断会注册一个执行未定义可执行文件的命令。

`packages/client/ui-memory-workspace/src/document-text.ts:documentText` 只保留 `getTextContent()` 返回的文本项。标记内容项仅在请求 `includeMarkedContent` 时才存在，而此调用未开启它，因此该过滤只是类型收窄，不会丢弃内容。

`packages/client/ui-plugin-manager/src/client/McpServersSection.tsx:reason` 把被拒绝的列表、发现或变更调用转换为其消息文本，对不是 `Error` 实例的值使用 `String(error)`，因此传输层的拒绝不会显示为空白提示。

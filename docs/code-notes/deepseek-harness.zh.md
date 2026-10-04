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

`packages/client/ui-settings-models/src/client/ModelsSection.tsx:Loaded` 不在提供商行中列出 `jev-router`。`packages/llm/llm-jev-router/src/index.ts:apply` 注册可配置提供商，只是为了让 `JevSettingsSection` 能从共享连接结果中读取其设置命名空间。Jev 是路由服务而不是适配器路由，如果在模型页面列出它，会提供一个密钥输入框，并在首次运行时显示一张并不能让用户获得模型提供商的设置卡片。

`packages/llm/llm-pi-ai/src/catalog-supplement.ts:SUPPLEMENT` 收录固定版本 pi-ai 目录中缺失的 `opencode-go` 模型，数据转录自 `opencode models opencode-go --verbose`（OpenCode 1.18.33）：`deepseek-v4.1-flash`、`gpt-6-luna`、`grok-4.7`、`longcat-2.5-preview-free`、`mimo-v2.6-flash`、`mimo-v2.6-pro` 和 `space-bunny-free`。pi-ai 的 `Model` 只接受文本和图像输入，因此音频、视频和 PDF 模态被省略，分级的长上下文价格采用基础费率。OpenAI 协议的模型使用 `openai-responses` 并设置 `sessionAffinityFormat: 'openai-nosession'`，与已安装的同类路由一致；其余模型沿用已安装的 OpenAI 兼容 `compat`。

`packages/client/ui-settings-models/src/client/ProviderEditor.tsx:applyOnce` 在 `storeCredential` 成功后立即重新读取已存储凭据的状态。否则密钥提示在每个凭据引用下只获取一次，导致在持续挂载的卡片上，点击应用后输入框被清空，而占位文字仍显示未设置。`packages/client/ui-settings-models/src/client/JevSettingsSection.tsx:JevSettingsSection` 使用共享的 `savedProvider` 文案提示保存成功，因为它的关闭处理只重新加载，页面看起来没有任何变化。被拒绝的后续读取不能撤销已成功的写入，因此当 `describeCredential` 返回 `undefined` 时，`applyOnce` 回退为已配置且可写的状态。`JevSettingsSection` 在新一次应用开始和取消编辑时清除保存提示，因此第二次应用失败时，不会在错误旁边显示先前的“已保存”消息。

`packages/client/ui-settings-plugin-inventory/src/client/HooksSettingsSection.tsx:HooksSettingsSection` 用一个搜索框过滤钩子，匹配范围包括来源文件、方言、脚本名、事件（含匹配器）、命令和描述。只要脚本分组中有任一处理器匹配，该分组就整体保留，因此分组开关仍作用于它所列出的每个处理器；搜索时隐藏“全部启用”和“全部禁用”按钮，因为它们作用于整个文件，包括被过滤隐藏的行。来源文件和每条命令以文本形式直接显示，而不是工具提示，用户由此可以找到定义某个钩子的文件。`hooksEmpty` 现在说明此页面只列出已加载的钩子桥接器，因为外部钩子文件从不显示在该页面上。

## MCP 连接状态与 OAuth 登录

`packages/mcp/mcp-client/src/status.ts:McpConnectionReport` 描述单个 HTTP 或 stdio MCP 服务器的真实连接状态：`connecting`、带工具数量的 `connected`、`auth-required`，或带错误信息的 `failed`。`packages/mcp/mcp-client/src/connection.ts:startConnection` 响应 `mcp-client/inventory` 事件，`packages/boot/plugin-manager/src/index.ts:PluginManager.listMcpServers` 发出该事件并把每条报告复制到 `McpServerRow.connection`。此前，只要插件 fiber 处于活动状态就显示"运行中"，即使服务器返回 401 且没有注册任何工具。

`packages/mcp/mcp-client/src/connection.ts:startConnection` 在服务器需要登录时不安排重连：401 会无限重复。该次尝试以 `auth-required` 结束，只有当 `credentials/record-updated` 报告该服务器的授权记录（登录完成时写入）后才重新连接。已建立的连接在授权失效时也会转为 `auth-required`：`startConnection` 包装提供方的 `onUnauthorized`，当其报告需要登录（`oauth.ts:isAuthRequired`）时，`signInLost` 关闭当前连接代且不安排重连。关闭会延后一个事件循环，使失败的工具或资源请求仍以模型可读的登录错误结束。任何刷新失败都会走到这里，因为 SDK 会回退到重新授权，而 `grantAuthProvider` 会将其转为 `AuthRequiredError`；只有授权服务器无法访问时连接才保持原状。`packages/client/ui-plugin-manager/src/client/McpServersSection.tsx:McpServersSection` 在有服务器连接中时每 1.5 秒、在任一已启用服务器报告连接状态时每 10 秒重新读取列表，因此之后失去登录或连接时无需用户操作即可显示。

`packages/mcp/mcp-client/src/oauth-flow.ts:signIn` 复用模型提供方的接缝：`registerOAuthFlow` 注册一个 `authorization` 流程，令牌与动态客户端注册信息保存在凭据 `grant` 记录中（`oauth.ts:grantKey`），浏览器通过 `authorization` Remote 命名空间访问它。`listenForCallback` 将回调监听绑定到 Harness 主机的 `127.0.0.1`，因此只有浏览器运行在同一台机器上时登录才能完成；其他设备上的浏览器无法访问该回调。

`packages/mcp/mcp-client/src/oauth-flow.ts:offerSignIn` 在服务器配置已包含 `Authorization` 请求头（`headers` 或 `headerEnv`，见 `oauth.ts:hasAuthorizationHeader`）时跳过 OAuth。此时静态令牌是唯一凭据，401 报告为 `failed` 而不是 `auth-required`。

`packages/client/ui-plugin-manager/src/client/McpServersSection.tsx:McpServersSection` 将"请求头"字段作为 `headers` 写入 profile 补丁行。请求头的值（包括令牌）以明文保存在 profile 的 `cordis.patch.yml` 中；表单提示说明了这一点，`headerEnv` 仍是让密钥不进入该文件的方式。

`packages/client/ui-plugin-manager/src/client/index.ts:apply` 为 MCP 段落提供自己的 `signInMcpServer` 回调，而不是复用模型页面的登录。功能插件不能导入其他插件的组件或值，因此该段落自行驱动 `remote.authorization.begin`、转发其提示，并在用户取消后把结束的流视为已完成而非错误。

## Jev 设置表单

`packages/client/ui-settings-models/src/client/JevFields.tsx:JevFields` 渲染 Jev 路由设置，这部分从 `ProviderEditor.tsx:ProviderEditor` 中移出，后者只保留 API 密钥字段。为路由选择模型时，会根据模型名称填写其 ID（`routeIdFor`）；若已有其他路由使用该 ID，则追加 `-2`、`-3`…。更换模型会重新设置 ID，除非用户在本次编辑中输入过该行的 ID；`typedIds` 记录这些行，因此输入的值（如 `model-7`）不会被替换。`ProviderEditor.tsx:applyOnce` 会拒绝保存重复的路由 ID 或指向不存在路由的回退值（`jevConfigFailure`），这与 `llm-jev-router` 加载时的两项检查一致。回退路由是一个包含 `keep` 和已配置路由 ID 的下拉框，重命名或删除其指向的路由时会同步更新。`packages/llm/llm-jev-router/src/index.ts:apply` 会拒绝指向不存在路由的回退值，而旧的自由文本字段允许这种情况。每个设置都带有通俗说明，并通过 `aria-describedby` 关联。

## 输入框中的路由模型

`packages/client/ui-model-selection/src/client/JevRouting.tsx:JevRouting` 是位于 `conversation.input.right`、紧挨模型选择器左侧的按钮。当 Jev 在本会话中做出过决定，或最近一次请求实际运行的模型与所选模型不同时显示，文字为"Jev"，路由时为"Jev：<model>"。点击后打开面板，列出当前运行的模型（`modelSelection.lastUsed`，来自每个 `request/header`）、所选模型（`modelSelection.next`）以及 Jev 最近的决定：路由及其置信度、保留聊天模型或失败原因。由于 `lastUsed` 的生命周期长于写入它的那一轮，把某个模型称为"当前运行"还要求所记录的请求属于正在进行的这一轮：在 Session 报告运行中的同时，`modelSelection.lastUsedSeq` 必须晚于最新 `turnOutline` 条目的 `turn/start` seq（`packages/session/session-turn-outline`）。缺少这一身份判断时，新一轮在写入自己的请求头之前会把上一轮的路由模型当作正在运行的模型。决定来自 `jevDecision` 投影（`packages/llm/llm-jev-router/src/projection.ts:jevDecisionProjection`），它保存最新的 `jev/decision`，因此重新加载或较早事件被分页移出后面板仍然可用。其类型通过路由器的 `./types` 与 `./client` 出口发布，客户端包仅以类型方式导入。聊天记录中不会新增任何内容。

## 模型选择器中的提供方筛选

`packages/client/ui-model-selection/src/client/ModelSelect.tsx:ModelSelect` 在加载了多个提供方时，于模型搜索框下方显示一行提供方筛选按钮（"全部"以及每个提供方分组各一个）。选择某个提供方会把 `visibleGroups` 缩小到该分组，并包含其中已收藏的模型，因此"收藏"分区仅在"全部"下显示；搜索仍在所选提供方内生效。每次打开选择器时，筛选都会重置为"全部"。这些筛选按钮使用共享的 `Pill` 组件。其所在行设为 `flex: 0 0 auto`：菜单卡片是限高的纵向布局，可收缩的行会被压到内容高度以下，与第一个分组标题重叠。

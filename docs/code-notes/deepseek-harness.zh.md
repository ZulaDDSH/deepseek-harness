# DeepSeek Harness 代码备注

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

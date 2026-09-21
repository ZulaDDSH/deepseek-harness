# DeepSeek Harness 代码备注

[English](deepseek-harness.md) | 中文

## 工作流仓库定位

`.github/issue-management/github.mjs:repositoryTarget` 在存在 `DSH_ISSUE_REPOSITORY` 时将 GitHub API 请求定位到启动工作流的仓库；本地策略测试仍使用规范项目回退值。机器人作者的拉取请求会跳过 Project 生命周期处理。

引用：`.github/workflows/ci.yml:node` 和 `scripts/ci-workflow.spec.ts:workflow`。拉取请求的 Linux 和 Windows 工作流默认使用标准 GitHub 托管运行器；`DSH_CI_FAILOVER_LINUX`、`DSH_CI_FAILOVER_WINDOWS` 以及明确指定的 Blacksmith 或 self-hosted 值仍保留为可选替代方案。

引用：`packages/api/settings-controller/src/request.ts:settingsRequest.parse`。授权与凭据请求验证共享同一个解析器，避免为相同的传输错误映射保留两份实现而违反重复代码检查。

## 预览产物

`.github/workflows/build-preview-cloudflare.yml:preview` 保留原有工作流标识，但生成 GitHub Actions 产物，不再部署到 Cloudflare。人工创建的拉取请求执行不可变依赖安装、工作区构建与预览构建，移除 source map，验证打包后的 gzip 镜像，并将预览产物保留七天。不需要 Cloudflare 凭据、外部部署或拉取请求评论；工作流只申请仓库读取权限。

## Models 可选授权

`packages/client/ui-settings-models/src/client/authorization-operations.ts:createAuthorizationOperations` 在页面确认命名空间可用后，通过 `ctx.get('remote.authorization')` 绑定该可选命名空间。回调使用已解析的命名空间，不再访问要求声明注入的属性。未配置授权服务的部署继续提供仅使用 API 密钥的 Models 页面。

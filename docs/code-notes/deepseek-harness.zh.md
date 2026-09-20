# DeepSeek Harness 代码备注

[English](deepseek-harness.md) | 中文

## 工作流仓库定位

`.github/issue-management/github.mjs:repositoryTarget` 在存在 `DSH_ISSUE_REPOSITORY` 时将 GitHub API 请求定位到启动工作流的仓库；本地策略测试仍使用规范项目回退值。自动化拉取请求不需要 Project 生命周期处理或 Cloudflare 预览，因此相应工作流会跳过机器人作者的拉取请求。

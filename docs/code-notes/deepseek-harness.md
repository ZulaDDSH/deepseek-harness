# DeepSeek Harness code notes

English | [中文](deepseek-harness.zh.md)

## Workflow repository targeting

`.github/issue-management/github.mjs:repositoryTarget` resolves GitHub API requests to the repository that launched the workflow when `DSH_ISSUE_REPOSITORY` is present; local policy tests retain the canonical project fallback. Automated pull requests do not need Project lifecycle work or Cloudflare previews, so the corresponding workflows skip those external integrations for bot-authored pull requests.

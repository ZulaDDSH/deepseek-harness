# DeepSeek Harness code notes

English | [中文](deepseek-harness.zh.md)

## Workflow repository targeting

`.github/issue-management/github.mjs:repositoryTarget` resolves GitHub API requests to the repository that launched the workflow when `DSH_ISSUE_REPOSITORY` is present; local policy tests retain the canonical project fallback. Project lifecycle work is skipped for bot-authored pull requests.

Reference: `.github/workflows/ci.yml:node` and `scripts/ci-workflow.spec.ts:workflow`. Pull-request Linux and Windows lanes use standard GitHub-hosted runners by default; `DSH_CI_FAILOVER_LINUX`, `DSH_CI_FAILOVER_WINDOWS`, and their explicit Blacksmith or self-hosted values retain the opt-in alternatives.

Reference: `packages/api/settings-controller/src/request.ts:settingsRequest.parse`. Authorization and credential request validation share one parser so the duplication gate does not accept two copies of the same wire-error mapping.

## Preview artifacts

`.github/workflows/build-preview-cloudflare.yml:preview` retains its workflow identity but builds a GitHub Actions artifact rather than deploying to Cloudflare. Human-authored pull requests run the immutable workspace and preview builds, remove source maps, validate the packed gzip image, and retain the preview artifact for seven days. No Cloudflare credentials, external deployment, or pull-request comments are required; the workflow only requests repository read permission.

## Optional Models authorization

`packages/client/ui-settings-models/src/client/authorization-operations.ts:createAuthorizationOperations` binds the optional namespace through `ctx.get('remote.authorization')` after the page has confirmed availability. Its callbacks use that resolved namespace rather than the required-injection accessor. Deployments without authorization retain the API-key-only Models page.

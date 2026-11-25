export const DEFAULT_FEED_REPOSITORY: string
export const FEED_TAG: string
export const FEED_FILES: readonly string[]

/**
 * Every url and path must become an absolute asset URL of the versioned release.
 * @param yamlText Contents of nightly.yml or stable.yml.
 * @param repository Owner and name of the GitHub repository.
 * @returns Release tag, installer asset names and rewritten metadata.
 */
export function rewriteFeedMetadata(yamlText: string, repository: string): { version: string, tag: string, assets: string[], yaml: string }

/**
 * Assets must be uploaded before the metadata, so the feed never names a missing asset.
 * @param options Artifact directory, target repository and injectable gh runner.
 * @returns What was, or in a dry run would be, published.
 */
export function publishGithubFeed(options: {
  directory: string
  repository?: string
  dryRun?: boolean
  gh?: (args: string[]) => string
  log?: (line: string) => void
}): { tag: string, feedFiles: readonly string[], yaml: string, uploaded: string[] }

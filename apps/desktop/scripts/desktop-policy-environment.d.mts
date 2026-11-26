/** Required deployment-selected metadata for mandatory-update policy requests. */
export interface DesktopPolicyEnvironment {
  origin: string
  allowedPageOrigins: string[]
  allowedAuthOrigins?: string[]
  authentication: 'anonymous' | 'feishu-test'
  [key: string]: unknown
}

/**
 * Resolve policy settings before artifact preparation or signing.
 * @param environment File-owned release settings; only the selected origin is required.
 * @returns Policy metadata with deployment-selected origin and authentication, or undefined when DSH_DESKTOP_UPDATE_FEED_URL is set.
 */
export function resolveDesktopPolicyEnvironment(environment: NodeJS.ProcessEnv): DesktopPolicyEnvironment | undefined

/**
 * Signed builds must keep the COS feed and policy, so only unsigned builds accept the GitHub feed.
 * @param environment File-owned release settings.
 * @param unsigned Whether the build is unsigned; a signed build rejects the setting.
 * @returns HTTPS feed directory URL ending in a slash, or undefined when unset or blank.
 */
export function resolveDesktopUpdateFeedUrl(environment: NodeJS.ProcessEnv, unsigned: boolean): string | undefined

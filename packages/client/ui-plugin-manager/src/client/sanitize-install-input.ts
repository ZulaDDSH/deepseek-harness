/** Privacy-safe installation input classification shared by click and result events. */

/**
 * Keep registry package names and plain versions; classify other installer inputs without their contents.
 * @param spec - user-entered installation spec.
 * @returns an identifier safe to send without URL credentials, tokens, or local paths.
 */
export function sanitizeInstallInput(spec: string): string {
  if (REGISTRY_IDENTIFIER.test(spec) && spec.length <= MAX_IDENTIFIER_LENGTH) {
    return isCredentialShaped(spec) ? '[credential-like]' : spec
  }
  if (/^(?:git[+:]|git@|github:|gitlab:|bitbucket:)/iu.test(spec)) return '[git]'
  if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(spec)) return '[url]'
  return '[path-or-other]'
}

const REGISTRY_IDENTIFIER = /^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*(?:@[a-z0-9.*^~+<>=| -]+)?$/iu
const MAX_IDENTIFIER_LENGTH = 256
const CREDENTIAL_PREFIX = /^(?:sk|pk|rk)[-_]|^gh[pousr]_|^github_pat_|^xox[abprs]-|^AKIA[0-9A-Z]{8,}|^npm_[a-z0-9]{20,}|^pypi-|^glpat-|^hf_[a-z0-9]{20,}|^eyj[a-z0-9_-]{10,}/iu
const OPAQUE_TOKEN = /^[a-z0-9_]{32,}$/iu

function isCredentialShaped(spec: string): boolean {
  const version = spec.slice(spec.lastIndexOf('@') + 1)
  return CREDENTIAL_PREFIX.test(spec) || CREDENTIAL_PREFIX.test(version)
    || (OPAQUE_TOKEN.test(spec) && /[a-z]/iu.test(spec) && /[0-9]/u.test(spec))
}

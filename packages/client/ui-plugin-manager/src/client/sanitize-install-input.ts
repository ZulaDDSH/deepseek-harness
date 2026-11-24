/** Privacy-safe installation input classification shared by click and result events. */

/**
 * Keep official package names and plain versions; classify other installer inputs without their contents.
 * @param spec - user-entered installation spec.
 * @param officialNames - package names of the official catalog; only these are ever reported by name.
 * @returns an identifier safe to send without URL credentials, tokens, private names, or local paths.
 */
export function sanitizeInstallInput(spec: string, officialNames: ReadonlySet<string>): string {
  const [, name = '', version] = REGISTRY_IDENTIFIER.exec(spec) ?? []
  if (name !== '') {
    if (!officialNames.has(name)) return '[package]'
    if (version === undefined) return name
    return `${name}@${PLAIN_VERSION.test(version) ? version : '[version]'}`
  }
  if (/^(?:git[+:]|git@|github:|gitlab:|bitbucket:)/iu.test(spec)) return '[git]'
  if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(spec)) return '[url]'
  return '[path-or-other]'
}

const REGISTRY_IDENTIFIER = /^((?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*)(?:@([a-z0-9.*^~+<>=| -]+))?$/iu
const PLAIN_VERSION = /^(?:[\^~]?\d+\.\d+\.\d+(?:-(?:alpha|beta|rc|next|canary)(?:\.\d+)?)?|latest|next|beta|alpha|canary|rc)$/u

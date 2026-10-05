/** Reject Chinese documentation artifacts and the translation machinery that produced them. */

import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')

/** One blocked documentation path and the policy it violates. */
export interface EnglishOnlyViolation {
  /** Repository-relative tracked path. */
  readonly path: string
  /** The English-only rule that path breaks. */
  readonly reason: string
}

/**
 * Blocked documentation artifacts, each with the rule it breaks.
 *
 * Product and runtime UI localization is out of scope: client locale
 * dictionaries, `zh-CN` product expectations, and localized assets keep their
 * Chinese strings because they are shipped UI, not documentation.
 */
const BLOCKED_PATHS: readonly { readonly reason: string; readonly matches: (path: string) => boolean }[] = [
  { reason: 'translated documentation counterpart', matches: path => path.endsWith('.zh.md') },
  { reason: 'documentation pairing record', matches: path => path.endsWith('.i18n.yaml') },
  { reason: 'bilingual documentation contract', matches: path => path.startsWith('docs/i18n/') },
  { reason: 'translation skill', matches: path => path.startsWith('.agents/skills/dsh-translate-docs/') },
  {
    reason: 'translation machinery',
    matches: path => path.startsWith('scripts/translation-')
      || path.startsWith('scripts/fixtures/translation-prompt/')
      || path.startsWith('scripts/snapshots/translation-prompt-v4/')
      || path === 'scripts/gen-translation-brief.ts'
      || path === 'scripts/verify-translation-pairing.ts'
      || path === 'scripts/verify-translation-prompt.ts',
  },
  { reason: 'translated documentation artifact', matches: path => /^(?:docs|website)\/.*\.zh(?:-CN)?\./u.test(path) },
  { reason: 'Chinese documentation-site route', matches: path => /^website\/(?:.*\/)?(?:zh|zh-CN)\//u.test(path) },
]

/**
 * Return the English-only violation for one repository-relative path.
 * @param path - repository-relative tracked path.
 * @returns the violated rule, or undefined when the path is allowed.
 */
export function englishOnlyViolation(path: string): string | undefined {
  return BLOCKED_PATHS.find(rule => rule.matches(path))?.reason
}

/**
 * Filter repository-relative paths down to the blocked documentation artifacts.
 * @param paths - repository-relative tracked paths.
 * @returns every violation in input order.
 */
export function englishOnlyViolations(paths: readonly string[]): EnglishOnlyViolation[] {
  return paths.flatMap((path) => {
    const reason = englishOnlyViolation(path)
    return reason === undefined ? [] : [{ path, reason }]
  })
}

function trackedFiles(repoRoot: string): string[] {
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot, encoding: 'utf8' })
    .split('\0')
    .filter(file => file !== '')
  if (!files.includes('AGENTS.md')
    || !files.some(file => file.startsWith('docs/'))
    || !files.some(file => file.startsWith('packages/'))) {
    throw new Error('verify-english-only-docs: tracked-file discovery omitted a required repository area')
  }
  return files
}

const invokedPath = process.argv[1]
const isMain = invokedPath !== undefined && import.meta.url === pathToFileURL(resolve(invokedPath)).href
if (isMain) {
  const named = process.argv.slice(2)
  const paths = named.length > 0 ? named : trackedFiles(root)
  const violations = englishOnlyViolations(paths)
  if (violations.length === 0) {
    console.log(`verify-english-only-docs: ${String(paths.length)} path(s) carry no translated documentation.`)
  } else {
    console.error('verify-english-only-docs: documentation is English only; remove these translated artifacts:')
    for (const violation of violations) console.error(`  ${violation.path} (${violation.reason})`)
    process.exitCode = 1
  }
}

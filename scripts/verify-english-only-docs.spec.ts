import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { englishOnlyViolation, englishOnlyViolations } from './verify-english-only-docs.ts'

const root = resolve(import.meta.dirname, '..')

describe('English-only documentation policy', () => {
  it.each([
    'README.zh.md',
    'docs/architecture.zh.md',
    'packages/mcp/mcp-client/README.zh.md',
    '.agents/notes/implemented/process/2026-01-01-example.zh.md',
    'docs/code-notes/deepseek-harness.i18n.yaml',
    'packages/example/README.i18n.yaml',
    'docs/i18n/README.md',
    '.agents/skills/dsh-translate-docs/SKILL.md',
    'scripts/translation-pairing.ts',
    'scripts/translation-pairing.manifest.json',
    'scripts/gen-translation-brief.ts',
    'scripts/verify-translation-pairing.ts',
    'scripts/verify-translation-prompt.ts',
    'scripts/fixtures/translation-prompt/examples/product.md',
    'scripts/snapshots/translation-prompt-v4/request-response.expected.json',
    'docs/user/guide/providers-models-page.zh.png',
    'website/tests/expected/page-markdown-actions.zh-CN.html',
    'website/zh/guide/quickstart.md',
    'website/zh-CN/index.md',
  ])('blocks %s', (path) => {
    expect(englishOnlyViolation(path)).toBeDefined()
  })

  it.each([
    'README.md',
    'docs/architecture.md',
    'docs/code-notes/deepseek-harness.md',
    'packages/client/ui-model-selection/src/client/locales.ts',
    'packages/client/ui-settings-session-log/tests/expected/upload-row.zh.txt',
    'packages/client/ui-settings-account/src/client/assets/onboarding-welcome-zh-dark.png',
    'apps/desktop/tests/expected/application-menu-zh-CN.json',
    'apps/web/tests/expected/shortcuts/zh-CN-saved.expected.md',
    'website/tests/expected/page-markdown-actions.en-US.html',
    'scripts/verify-md-links.ts',
  ])('allows product UI localization and English documentation: %s', (path) => {
    expect(englishOnlyViolation(path)).toBeUndefined()
  })

  it('reports every violation with its rule in input order', () => {
    expect(englishOnlyViolations(['README.md', 'docs/a.zh.md', 'docs/b.i18n.yaml'])).toEqual([
      { path: 'docs/a.zh.md', reason: 'translated documentation counterpart' },
      { path: 'docs/b.i18n.yaml', reason: 'documentation pairing record' },
    ])
  })

  it('finds no violation in the shipped tracked corpus', () => {
    const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
      .split('\0')
      .filter(file => file !== '')
    expect(tracked.length).toBeGreaterThan(0)
    expect(englishOnlyViolations(tracked)).toEqual([])
  })
})

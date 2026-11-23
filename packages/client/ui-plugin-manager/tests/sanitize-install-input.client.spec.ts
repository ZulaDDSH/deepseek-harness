import { expect, it } from 'vitest'
import { sanitizeInstallInput } from '../src/client/sanitize-install-input.ts'

it.each(['dsh-example', '@scope/plugin', '@scope/plugin@1.2.3', 'plugin@latest'])('retains a registry identifier: %s', (spec) => {
  expect(sanitizeInstallInput(spec)).toBe(spec)
})

it.each([
  ['git+https://user:secret@example.invalid/org/repo.git?token=secret#secret', '[git]'],
  ['https://user:secret@example.invalid/archive.tgz?signature=secret#secret', '[url]'],
  ['git@example.invalid:private/repo', '[git]'],
  ['/Users/private-name/plugin', '[path-or-other]'],
  ['C:\\Users\\private-name\\plugin', '[path-or-other]'],
  ['plugin@https://user:secret@example.invalid/archive.tgz', '[path-or-other]'],
])('removes private installer input: %s', (spec, expected) => {
  expect(sanitizeInstallInput(spec)).toBe(expected)
})

it.each([
  'sk-proj-abc123DEF456ghi789',
  'ghp_fixture',
  'github_pat_fixture',
  'xoxb-fixture',
  'AKIAFIXTURES',
  'plugin@sk-proj-abc123DEF456',
  'abcdef0123456789abcdef0123456789',
])('classifies a credential-shaped identifier without echoing it: %s', (spec) => {
  expect(sanitizeInstallInput(spec)).toBe('[credential-like]')
})

it('bounds registry-shaped input at 256 characters', () => {
  expect(sanitizeInstallInput('a'.repeat(256))).toBe('a'.repeat(256))
  expect(sanitizeInstallInput('a'.repeat(257))).toBe('[path-or-other]')
})

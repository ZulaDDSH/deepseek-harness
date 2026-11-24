import { expect, it } from 'vitest'
import { sanitizeInstallInput } from '../src/client/sanitize-install-input.ts'

const OFFICIAL = new Set(['dsh-example', '@scope/plugin', '@sk-team/pkg', 'sk-utils'])

it.each([
  ['dsh-example', 'dsh-example'],
  ['@scope/plugin', '@scope/plugin'],
  ['@scope/plugin@1.2.3', '@scope/plugin@1.2.3'],
  ['dsh-example@^1.2.3', 'dsh-example@^1.2.3'],
  ['dsh-example@~1.2.3', 'dsh-example@~1.2.3'],
  ['dsh-example@1.2.3-rc.1', 'dsh-example@1.2.3-rc.1'],
  ['dsh-example@latest', 'dsh-example@latest'],
  ['dsh-example@next', 'dsh-example@next'],
  ['@sk-team/pkg', '@sk-team/pkg'],
  ['sk-utils', 'sk-utils'],
])('retains an official package and a plain version: %s', (spec, expected) => {
  expect(sanitizeInstallInput(spec, OFFICIAL)).toBe(expected)
})

it.each([
  'dsh-example@sk-proj-abc123DEF456',
  'dsh-example@abcdef0123456789abcdef0123456789',
  'dsh-example@AKIAFIXTURES',
  'dsh-example@1.2.3-secret',
  'dsh-example@>=1.0.0 <2',
  'dsh-example@1.2',
])('does not echo an unrecognized version of an official package: %s', (spec) => {
  expect(sanitizeInstallInput(spec, OFFICIAL)).toBe('dsh-example@[version]')
})

it.each([
  'dsh-new',
  'rk-ui-kit@1.0.0',
  'pk_helper',
  'akiamusicplayer1',
  'sk-proj-abc123DEF456ghi789',
  'ghp_fixture',
  'github_pat_fixture',
  'xoxb-fixture',
  'AKIAFIXTURES',
  'plugin@AKIAFIXTURES',
  'sk_live_abcdef0123456789',
  'plugin@sk-proj-abc123DEF456',
  'abcdef0123456789abcdef0123456789',
  'abcdef0123456789abcdef0123456789@latest',
  'plugin@abcdef0123456789abcdef0123456789',
  'unknown-name-with-no-credential-shape',
])('reports a package that is not official only as a package: %s', (spec) => {
  expect(sanitizeInstallInput(spec, OFFICIAL)).toBe('[package]')
})

it('bounds the output for an oversized registry-shaped input', () => {
  expect(sanitizeInstallInput('a'.repeat(1000), OFFICIAL)).toBe('[package]')
})

it('treats every name as unofficial when no official names are known', () => {
  expect(sanitizeInstallInput('dsh-example', new Set())).toBe('[package]')
})

it.each([
  ['git+https://user:secret@example.invalid/org/repo.git?token=secret#secret', '[git]'],
  ['https://user:secret@example.invalid/archive.tgz?signature=secret#secret', '[url]'],
  ['git@example.invalid:private/repo', '[git]'],
  ['/Users/private-name/plugin', '[path-or-other]'],
  ['C:\\Users\\private-name\\plugin', '[path-or-other]'],
  ['plugin@https://user:secret@example.invalid/archive.tgz', '[path-or-other]'],
  ['dsh-example@https://user:secret@example.invalid/archive.tgz', '[path-or-other]'],
])('removes private installer input: %s', (spec, expected) => {
  expect(sanitizeInstallInput(spec, OFFICIAL)).toBe(expected)
})

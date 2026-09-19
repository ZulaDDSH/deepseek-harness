import assert from 'node:assert/strict'
import test from 'node:test'
import { hasMemorixEntry, mergeMemorixPatch } from './setup-memorix-desktop-lib.mjs'

const cli = 'C:\\\\Users\\\\dev\\\\.dsh\\\\profiles\\\\desktop\\\\node_modules\\\\memorix\\\\dist\\\\cli\\\\index.js'

test('replaces the default empty patch list', () => {
  const result = mergeMemorixPatch('# user patch\n[]\n', cli)
  assert.match(result, /memory-memorix/u)
  assert.ok(result.includes('MEMORIX_SQLITE_DRIVER: "node"'))
  assert.match(result, /- --mode\n\s*- lite/u)
  assert.doesNotMatch(result, /^\[\]$/mu)
})

test('appends to an existing block patch list', () => {
  const source = '- config:\n    id: existing\n'
  const result = mergeMemorixPatch(source, cli)
  assert.ok(result.startsWith(source))
  assert.match(result, /memory-memorix/u)
})

test('does not duplicate an existing Memorix entry', () => {
  const source = '- insert:\n    - id: memory-memorix\n      name: x\n'
  assert.equal(mergeMemorixPatch(source, cli), source)
  assert.equal(hasMemorixEntry(source), true)
})

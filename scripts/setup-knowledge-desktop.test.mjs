import assert from 'node:assert/strict'
import test from 'node:test'
import { hasKnowledgeEntry, mergeKnowledgePatch } from './setup-knowledge-desktop-lib.mjs'

const url = 'http://192.168.1.50:18080/mcp'
const variable = 'GARDEN_KNOWLEDGE_TOKEN'

test('replaces the default empty patch list', () => {
  const result = mergeKnowledgePatch('# user patch\n[]\n', url, variable)
  assert.match(result, /knowledge-shared/u)
  assert.ok(result.includes('transport: streamable-http'))
  assert.ok(result.includes(url))
  assert.doesNotMatch(result, /^\[\]$/mu)
})

test('names the credential variable instead of the credential', () => {
  const result = mergeKnowledgePatch('', url, variable)
  assert.ok(result.includes('headerEnv:'))
  assert.ok(result.includes(variable))
  assert.doesNotMatch(result, /Authorization:\s*Bearer/u)
})

test('appends to an existing block patch list', () => {
  const source = '- config:\n    id: existing\n'
  const result = mergeKnowledgePatch(source, url, variable)
  assert.ok(result.startsWith(source))
  assert.match(result, /knowledge-shared/u)
})

test('does not duplicate an existing knowledge entry', () => {
  const source = '- insert:\n    - id: knowledge-shared\n      name: x\n'
  assert.equal(mergeKnowledgePatch(source, url, variable), source)
  assert.equal(hasKnowledgeEntry(source), true)
})

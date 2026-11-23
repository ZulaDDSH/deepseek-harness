import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { test } from 'node:test'
import {
  accountKey,
  legacyAccountKey,
  readOwnership,
  reconcileOwnership,
  updateOwnership,
} from '../ownership.js'

async function scratch(t) {
  const dir = await mkdtemp(join(tmpdir(), 'claude-ownership-test-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return join(dir, 'accounts')
}

const empty = () => ({ owners: new Map(), rejected: new Map(), displaced: [], corrupt: false })
const row = (id, key, extra = {}) => ({
  id,
  attempt: false,
  created: 0,
  status: key ? { signedIn: true, accountKey: key, legacyKey: 'legacy-' + key } : { signedIn: false },
  ...extra,
})

test('account keys cover email and organisation, ignore case, and are salted per install', async (t) => {
  const a = await scratch(t)
  const b = await scratch(t)
  const key = accountKey(a, 'One@Example.test ', 'org-1')
  assert.equal(key, accountKey(a, 'one@example.test', 'org-1'))
  assert.notEqual(key, accountKey(a, 'one@example.test', 'org-2'))
  assert.notEqual(key, accountKey(a, 'one@example.test', undefined))
  assert.notEqual(key, accountKey(b, 'one@example.test', 'org-1'))
  assert.notEqual(accountKey(a, 'one@example.test', ''), legacyAccountKey('one@example.test'))
  assert.match(key, /^[0-9a-f]{64}$/)
  if (process.platform !== 'win32') {
    assert.equal((await stat(a)).mode & 0o777, 0o700)
    assert.equal((await stat(join(a, '.ownership-secret'))).mode & 0o777, 0o600)
  }
})

test('a missing registry is empty and not corrupt', async (t) => {
  const state = readOwnership(await scratch(t))
  assert.equal(state.corrupt, false)
  assert.equal(state.owners.size + state.rejected.size, 0)
})

test('unparseable, mis-shaped and unknown-version registries read as corrupt and empty', async (t) => {
  const root = await scratch(t)
  await updateOwnership(root, async () => [])
  for (const text of [
    '{nope',
    'null',
    '[]',
    JSON.stringify({ version: 3, owners: [], rejected: [] }),
    JSON.stringify({ version: 2, owners: 'x', rejected: [] }),
    JSON.stringify({ version: 2, owners: [[1, 'main']], rejected: [] }),
    JSON.stringify({ version: 2, owners: [], rejected: [['work', null]] }),
  ]) {
    await writeFile(join(root, '.ownership.json'), text)
    const state = readOwnership(root)
    assert.equal(state.corrupt, true, text)
    assert.equal(state.owners.size + state.rejected.size, 0, text)
  }
})

test('updating over a corrupt registry keeps a backup once and writes a valid file', async (t) => {
  const root = await scratch(t)
  await updateOwnership(root, async () => [])
  await writeFile(join(root, '.ownership.json'), '{nope')
  await updateOwnership(root, async () => [row('main', 'k1')])
  await updateOwnership(root, async () => [row('main', 'k1')])
  const backups = (await readdir(root)).filter((f) => f.startsWith('.ownership.json.corrupt-'))
  assert.equal(backups.length, 1)
  assert.equal(await readFile(join(root, backups[0]), 'utf8'), '{nope')
  const state = readOwnership(root)
  assert.equal(state.corrupt, false)
  assert.equal(state.owners.get('k1'), 'main')
})

test('observation runs outside the registry lock', async (t) => {
  const root = await scratch(t)
  let running = 0
  let peak = 0
  const observe = async () => {
    peak = Math.max(peak, ++running)
    await sleep(80)
    running--
    return []
  }
  await Promise.all([updateOwnership(root, observe), updateOwnership(root, observe)])
  assert.equal(peak, 2)
})

test('the default profile owns its account and a displaced managed profile is reported', () => {
  const state = empty()
  state.owners.set('k1', 'work')
  reconcileOwnership([row('main', 'k1'), row('work', 'k1')], state)
  assert.equal(state.owners.get('k1'), 'main')
  assert.deepEqual(state.displaced, ['work'])
  assert.deepEqual(state.rejected.get('work'), { key: 'k1', owner: 'main' })
})

test('without a conflict nothing is displaced and the oldest managed profile wins', () => {
  const state = empty()
  reconcileOwnership([row('b', 'k1', { created: 2 }), row('a', 'k1', { created: 1 }), row('c', 'k2')], state)
  assert.deepEqual(state.displaced, [])
  assert.equal(state.owners.get('k1'), 'a')
  assert.equal(state.owners.get('k2'), 'c')
  assert.equal(state.rejected.get('b').owner, 'a')
})

test('old email-hash entries migrate to the identity key', () => {
  const state = empty()
  state.owners.set('legacy-k1', 'work')
  state.rejected.set('dup', { key: 'legacy-k1', owner: 'work' })
  reconcileOwnership([row('work', 'k1'), row('dup', 'k2')], state)
  assert.equal(state.owners.get('k1'), 'work')
  assert.ok(!state.owners.has('legacy-k1'))
  assert.equal(state.owners.get('k2'), 'dup')
  assert.equal(state.rejected.size, 0)
})

test('migrated entries still reject a real duplicate in the same organisation', () => {
  const state = empty()
  state.owners.set('legacy-k1', 'work')
  state.rejected.set('dup', { key: 'legacy-k1', owner: 'work' })
  reconcileOwnership([row('work', 'k1'), row('dup', 'k1')], state)
  assert.deepEqual(state.rejected.get('dup'), { key: 'k1', owner: 'work' })
})

test('an entry of a profile that could not be read survives, a vanished profile loses its entry', () => {
  const state = empty()
  state.owners.set('k1', 'broken')
  state.owners.set('k2', 'gone')
  reconcileOwnership([row('broken', undefined, { status: { signedIn: false, error: 'x' } })], state)
  assert.equal(state.owners.get('k1'), 'broken')
  assert.ok(!state.owners.has('k2'))
})

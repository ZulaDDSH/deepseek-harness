import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { mock, test } from 'node:test'
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

test('a rejected duplicate keeps its place while the legacy owner cannot be read', () => {
  const state = empty()
  state.owners.set('legacy-k1', 'work')
  state.rejected.set('dup', { key: 'legacy-k1', owner: 'work' })
  const broken = row('work', undefined, { status: { signedIn: false, error: 'x' } })
  reconcileOwnership([broken, row('dup', 'k1')], state)
  assert.equal(state.owners.get('legacy-k1'), 'work')
  assert.ok(!state.owners.has('k1'))
  assert.deepEqual(state.rejected.get('dup'), { key: 'legacy-k1', owner: 'work' })
  reconcileOwnership([broken, row('dup', 'k1')], state)
  assert.ok(!state.owners.has('k1'))
  reconcileOwnership([row('work', 'k1'), row('dup', 'k1')], state)
  assert.equal(state.owners.get('k1'), 'work')
  assert.ok(!state.owners.has('legacy-k1'))
  assert.deepEqual(state.rejected.get('dup'), { key: 'k1', owner: 'work' })
})

test('a legacy rejected entry is dropped when its owner signed out or vanished', () => {
  const state = empty()
  state.owners.set('legacy-k1', 'gone')
  state.rejected.set('dup', { key: 'legacy-k1', owner: 'gone' })
  state.rejected.set('dup2', { key: 'legacy-k2', owner: 'out' })
  reconcileOwnership([row('dup', 'k1'), row('dup2', 'k2'), row('out', undefined)], state)
  assert.equal(state.rejected.size, 0)
  assert.equal(state.owners.get('k1'), 'dup')
  assert.equal(state.owners.get('k2'), 'dup2')
})

test('displaced profiles are stored, survive a reload and clear when the cause is gone', async (t) => {
  const root = await scratch(t)
  const displaced = [row('main', 'k1'), row('work', 'k1')]
  await updateOwnership(root, async () => [row('work', 'k1')])
  const first = await updateOwnership(root, async () => displaced)
  assert.deepEqual(first.state.displaced, ['work'])
  assert.deepEqual(readOwnership(root).displaced, ['work'])
  const again = await updateOwnership(root, async () => displaced)
  assert.deepEqual(again.state.displaced, ['work'])
  const cleared = await updateOwnership(root, async () => [row('main', 'k1'), row('work', 'k2')])
  assert.deepEqual(cleared.state.displaced, [])
  assert.deepEqual(readOwnership(root).displaced, [])
  await updateOwnership(root, async () => displaced)
  const removed = await updateOwnership(root, async () => [row('main', 'k1')])
  assert.deepEqual(removed.state.displaced, [])
})

test('an empty or short secret file is replaced and no temporary file is left', async (t) => {
  for (const stale of ['', 'abc\n']) {
    const root = await scratch(t)
    await mkdir(root, { recursive: true })
    await writeFile(join(root, '.ownership-secret'), stale)
    const key = accountKey(root, 'one@example.test', 'org')
    assert.match(key, /^[0-9a-f]{64}$/)
    assert.match(await readFile(join(root, '.ownership-secret'), 'utf8'), /^[0-9a-f]{64}$/)
    assert.deepEqual((await readdir(root)).filter((f) => f !== '.ownership-secret'), [])
  }
})

test('the displaced notice clears when the default profile moves to another account or signs out', async (t) => {
  for (const next of [row('main', 'k2'), row('main', undefined)]) {
    const root = await scratch(t)
    await updateOwnership(root, async () => [row('work', 'k1')])
    const shown = await updateOwnership(root, async () => [row('main', 'k1'), row('work', 'k1')])
    assert.deepEqual(shown.state.displaced, ['work'])
    const gone = await updateOwnership(root, async () => [next, row('work', 'k1')])
    assert.deepEqual(gone.state.displaced, [])
    assert.deepEqual(readOwnership(root).displaced, [])
    assert.equal(readOwnership(root).rejected.size, 0)
  }
})

test('a rejected entry whose account has no owner is dropped', () => {
  const state = empty()
  state.rejected.set('dup', { key: 'k9', owner: 'gone' })
  reconcileOwnership([row('dup', undefined)], state)
  assert.equal(state.rejected.size, 0)
})

for (const code of ['EPERM', 'ENOSYS', 'EXDEV']) {
  test(`the secret is still created when hard links fail with ${code}`, { skip: !mock.module }, async (t) => {
    const { copyFileSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } = await import('node:fs')
    t.mock.module('node:fs', {
      namedExports: {
        copyFileSync,
        mkdirSync,
        readFileSync,
        renameSync,
        unlinkSync,
        writeFileSync,
        linkSync() {
          throw Object.assign(new Error('no links'), { code })
        },
      },
    })
    const fallback = await import(`../ownership.js?link-${code}`)
    const root = await scratch(t)
    const key = fallback.accountKey(root, 'one@example.test', 'org')
    assert.match(key, /^[0-9a-f]{64}$/)
    assert.match(await readFile(join(root, '.ownership-secret'), 'utf8'), /^[0-9a-f]{64}$/)
    assert.deepEqual((await readdir(root)).filter((f) => f !== '.ownership-secret'), [])
    assert.equal(key, fallback.accountKey(root, 'one@example.test', 'org'))
  })
}

for (const failure of ['EEXIST', 'EPERM']) {
  test(`the secret written by a competing process wins after a ${failure} link failure`, { skip: !mock.module }, async (t) => {
    const { copyFileSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } = await import('node:fs')
    const winner = 'ab'.repeat(32)
    t.mock.module('node:fs', {
      namedExports: {
        copyFileSync,
        mkdirSync,
        readFileSync,
        renameSync,
        unlinkSync,
        writeFileSync,
        linkSync(_temp, file) {
          writeFileSync(file, winner)
          throw Object.assign(new Error('lost the race'), { code: failure })
        },
      },
    })
    const competing = await import(`../ownership.js?race-${failure}`)
    const root = await scratch(t)
    const key = competing.accountKey(root, 'one@example.test', 'org')
    const expected = createHmac('sha256', winner).update(JSON.stringify(['one@example.test', 'org'])).digest('hex')
    assert.equal(key, expected)
    assert.equal(await readFile(join(root, '.ownership-secret'), 'utf8'), winner)
    assert.deepEqual((await readdir(root)).filter((f) => f !== '.ownership-secret'), [])
  })
}

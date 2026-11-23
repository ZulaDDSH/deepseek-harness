import { createHash, createHmac, randomBytes } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'

const secrets = new Map()

function secretFor(root) {
  let secret = secrets.get(root)
  if (secret) return secret
  mkdirSync(root, { recursive: true, mode: 0o700 })
  const file = join(root, '.ownership-secret')
  try {
    writeFileSync(file, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 })
  } catch (err) {
    if (err.code !== 'EEXIST') throw err
  }
  secret = readFileSync(file, 'utf8').trim()
  if (secret.length !== 64) throw new Error('The Claude account secret is unreadable.')
  secrets.set(root, secret)
  return secret
}

export function accountKey(root, email, orgId) {
  return createHmac('sha256', secretFor(root))
    .update(JSON.stringify([email.trim().toLowerCase(), orgId || '']))
    .digest('hex')
}

export function legacyAccountKey(email) {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex')
}

const emptyState = (corrupt = false) => ({ owners: new Map(), rejected: new Map(), displaced: [], corrupt })

const validOwner = (e) => Array.isArray(e) && typeof e[0] === 'string' && typeof e[1] === 'string'
const validRejected = (e) =>
  Array.isArray(e) && typeof e[0] === 'string' && typeof e[1]?.key === 'string' && typeof e[1]?.owner === 'string'

export function readOwnership(root) {
  let text
  try {
    text = readFileSync(join(root, '.ownership.json'), 'utf8')
  } catch (err) {
    if (err.code === 'ENOENT') return emptyState()
    throw err
  }
  try {
    const data = JSON.parse(text)
    if (
      (data.version !== 1 && data.version !== 2) ||
      !Array.isArray(data.owners) ||
      !Array.isArray(data.rejected) ||
      !data.owners.every(validOwner) ||
      !data.rejected.every(validRejected)
    )
      return emptyState(true)
    return { ...emptyState(), owners: new Map(data.owners), rejected: new Map(data.rejected) }
  } catch {
    return emptyState(true)
  }
}

export function reconcileOwnership(entries, state) {
  const byId = new Map(entries.map((e) => [e.id, e]))
  for (const row of entries) {
    const { accountKey: key, legacyKey } = row.status
    if (!key || !legacyKey) continue
    if (state.owners.get(legacyKey) === row.id && !state.owners.has(key)) {
      state.owners.delete(legacyKey)
      state.owners.set(key, row.id)
    }
    if (state.rejected.get(row.id)?.key === legacyKey) state.rejected.delete(row.id)
  }
  for (const [key, id] of state.owners) {
    const row = byId.get(id)
    if (!row || (!row.status.error && row.status.accountKey !== key)) state.owners.delete(key)
  }
  const ordered = [...entries].sort(
    (a, b) =>
      Number(b.id === 'main') - Number(a.id === 'main') ||
      Number(a.attempt) - Number(b.attempt) ||
      a.created - b.created ||
      a.id.localeCompare(b.id),
  )
  for (const row of ordered) {
    const key = row.status.accountKey
    if (!key) continue
    const prior = state.rejected.get(row.id)
    if (prior && prior.key !== key) state.rejected.delete(row.id)
    if (row.id === 'main' || (!state.owners.has(key) && !state.rejected.has(row.id))) {
      const previous = state.owners.get(key)
      if (previous && previous !== row.id) state.displaced.push(previous)
      state.owners.set(key, row.id)
    }
    const owner = state.owners.get(key)
    if (owner === row.id) state.rejected.delete(row.id)
    else if (owner) state.rejected.set(row.id, { key, owner })
  }
  return state
}

export async function updateOwnership(root, observe) {
  const rows = await observe()
  mkdirSync(root, { recursive: true, mode: 0o700 })
  const file = join(root, '.ownership.json')
  return withFileLock(
    file,
    async () => {
      const state = readOwnership(root)
      const encode = () =>
        JSON.stringify({ version: 2, owners: [...state.owners], rejected: [...state.rejected] })
      const before = encode()
      if (state.corrupt) copyFileSync(file, `${file}.corrupt-${Date.now()}`)
      reconcileOwnership(rows, state)
      const after = encode()
      if (state.corrupt || before !== after) await writeFileAtomic(file, after, { mode: 0o600 })
      return { rows, state }
    },
    { waitMs: 40000 },
  )
}

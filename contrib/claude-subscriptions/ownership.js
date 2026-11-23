import { readFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'

export function readOwnership(root) {
  try {
    const data = JSON.parse(readFileSync(join(root, '.ownership.json'), 'utf8'))
    if (data.version !== 1) throw new Error('Unexpected Claude account registry version.')
    return { owners: new Map(data.owners), rejected: new Map(data.rejected) }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
    return { owners: new Map(), rejected: new Map() }
  }
}

export function reconcileOwnership(entries, state) {
  const byId = new Map(entries.map((e) => [e.id, e]))
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
      state.owners.set(key, row.id)
    }
    const owner = state.owners.get(key)
    if (owner === row.id) state.rejected.delete(row.id)
    else if (owner) state.rejected.set(row.id, { key, owner })
  }
  return state
}

export async function updateOwnership(root, observe) {
  mkdirSync(root, { recursive: true })
  const file = join(root, '.ownership.json')
  return withFileLock(
    file,
    async () => {
      const rows = await observe()
      const state = readOwnership(root)
      const encode = () =>
        JSON.stringify({ version: 1, owners: [...state.owners], rejected: [...state.rejected] })
      const before = encode()
      reconcileOwnership(rows, state)
      const after = encode()
      if (before !== after) await writeFileAtomic(file, after, { mode: 0o600 })
      return { rows, state }
    },
    { waitMs: 40000 },
  )
}

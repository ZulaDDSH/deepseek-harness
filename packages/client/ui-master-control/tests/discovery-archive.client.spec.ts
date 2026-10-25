import { expect, it } from 'vitest'
import { masterRows } from '../src/client/rows.ts'

it('archives idle chats at exactly seven days and keeps running and recent source chats active', () => {
  const now = 10 * 86_400_000
  const byId = Object.fromEntries([
    ['old', { updatedAt: now - 7 * 86_400_000 }],
    ['recent', { updatedAt: now - 7 * 86_400_000 + 1 }],
    ['running', { updatedAt: 0, running: true }],
    ['imported', { updatedAt: 0 }],
    ['manual', { updatedAt: now }],
    ['continued', { updatedAt: now }],
  ].map(([id, value]) => [id, { displayTitle: id, blank: false, running: false, ...(value as object) }]))
  const rows = masterRows({ ids: Object.keys(byId), byId } as never, new Map(), now, ['manual'], { imported: now, continued: 0 })
  expect(rows.filter(row => row.archived).map(row => row.id).sort()).toEqual(['manual', 'old'])
})

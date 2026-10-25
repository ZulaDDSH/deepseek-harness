import { expect, it, vi } from 'vitest'
import type { ExternalChatCatalog } from '@deepseek-ai/dsh-api-session-controller/client'
import { masterRows } from '../src/client/rows.ts'
import { syncMissingChats } from '../src/client/sync-chats.ts'

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

it('continues later batches when an individual import fails', async () => {
  const catalog = { limited: false, items: Array.from({ length: 101 }, (_, n) => ({ key: String(n) })) } as ExternalChatCatalog
  const known = new Set<string>()
  const importChats = vi.fn(async (keys: readonly string[]) => ({ items: keys.map(key => key === '0'
    ? { key, error: 'Unavailable chat' } : { key, sessionId: `imported-chat-${key}` }) }))
  await expect(syncMissingChats(catalog, known, importChats as never, new AbortController().signal)).rejects.toThrow('Unavailable chat')
  expect(importChats).toHaveBeenCalledTimes(2)
  expect(known.has('imported-chat-100')).toBe(true)
})

it('imports all missing chats in bounded batches and skips existing copies and invalid previews', async () => {
  const catalog = { limited: false, items: Array.from({ length: 206 }, (_, n) => ({ key: String(n) })) } as ExternalChatCatalog
  const known = new Set(['imported-chat-0'])
  const importChats = vi.fn(async (keys: readonly string[]) => ({ items: keys.map(key => ({ key, sessionId: `imported-chat-${key}` })) }))
  await syncMissingChats(catalog, known, importChats as never, new AbortController().signal)
  expect(importChats.mock.calls.map(([keys]) => keys.length)).toEqual([100, 100, 5])
  expect(known.size).toBe(206)
  await syncMissingChats(catalog, known, importChats as never, new AbortController().signal)
  expect(importChats).toHaveBeenCalledTimes(3)
})

it('stops admitting batches after unmount and reports individual import errors', async () => {
  const controller = new AbortController()
  const catalog = { limited: false, items: [{ key: 'good' }, { key: 'bad', error: 'invalid' }] } as ExternalChatCatalog
  const importChats = vi.fn(async () => ({ items: [{ key: 'good', error: 'Disk full' }] }))
  controller.abort()
  await syncMissingChats(catalog, new Set(), importChats as never, controller.signal)
  expect(importChats).not.toHaveBeenCalled()
  await expect(syncMissingChats(catalog, new Set(), importChats as never, new AbortController().signal)).rejects.toThrow('Disk full')
  expect(importChats).toHaveBeenCalledWith(['good'])
})

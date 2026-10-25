import { mkdtemp, mkdir, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { ExternalChats } from '../src/external-chats.ts'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'external-discovery-'))
  roots.push(root)
  const claude = join(root, 'claude')
  const codex = join(root, 'codex')
  await mkdir(join(claude, 'project'), { recursive: true })
  await mkdir(codex)
  return { claude, codex, chats: new ExternalChats({ claude, codex }) }
}

const prompt = JSON.stringify({ type: 'user', message: { role: 'user', content: 'An active Claude chat' } })

it('imports a large tool-heavy transcript without retaining tool output', async () => {
  const { claude, chats } = await fixture()
  const tool = JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'x'.repeat(17 * 1024 * 1024) }] } })
  await writeFile(join(claude, 'project', 'large.jsonl'), `${prompt}\n${tool}\n`)
  const catalog = await chats.discover()
  expect(catalog.items[0]?.error).toBeUndefined()
  expect((await chats.read(catalog.items[0]!.key)).messages).toEqual([{ role: 'user', text: 'An active Claude chat' }])
})

it('discovers every chat beyond the former first hundred', async () => {
  const { claude, chats } = await fixture()
  await Promise.all(Array.from({ length: 105 }, (_, n) => writeFile(join(claude, 'project', `${n}.jsonl`), prompt)))
  expect((await chats.discover()).items).toHaveLength(105)
})

it('keeps completed records when a live transcript has an unfinished final write', async () => {
  const { claude, chats } = await fixture()
  await writeFile(join(claude, 'project', 'live.jsonl'), `${prompt}\n{"type":"assistant"`)
  const catalog = await chats.discover()
  expect(catalog.items[0]?.error).toBeUndefined()
  expect(catalog.items[0]?.messageCount).toBe(1)
})

it('preserves source activity independently of when a copy is imported', async () => {
  const { claude, chats } = await fixture()
  const file = join(claude, 'project', 'old.jsonl')
  await writeFile(file, prompt)
  const old = new Date('2026-10-01T00:00:00Z')
  await utimes(file, old, old)
  const catalog = await chats.discover()
  expect((await chats.read(catalog.items[0]!.key)).updatedAt).toBe(old.getTime())
})

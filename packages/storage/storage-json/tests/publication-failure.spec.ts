import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { KvUnit, KvUnitDescriptor } from '@deepseek-ai/dsh-storage'
import { JsonStorageBackend } from '../src/index.ts'

const gates = vi.hoisted(() => ({ failSync: false }))

vi.mock('../src/dirsync.ts', () => ({
  fsyncDirectory: (): Promise<void> => {
    if (gates.failSync) return Promise.reject(new Error('EIO: injected directory sync failure'))
    return Promise.resolve()
  },
}))

const roots: string[] = []
async function freshRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-publication-failure-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  gates.failSync = false
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

const single: KvUnitDescriptor = { name: 'single', version: 1, tables: ['t'], hasGlobal: true }
const perRecord: KvUnitDescriptor = { name: 'perrecord', version: 1, layout: 'per-record', tables: ['t'], hasGlobal: true }

async function open(descriptor: KvUnitDescriptor, root: string): Promise<{ backend: JsonStorageBackend; unit: KvUnit }> {
  const backend = new JsonStorageBackend(root)
  return { backend, unit: await backend.kv.open(descriptor) }
}

describe('a directory-sync failure after the rename published the document', () => {
  it.each([
    ['putRecord', (unit: KvUnit) => unit.putRecord('t', 'k', { v: 2 })],
    ['setGlobal', (unit: KvUnit) => unit.setGlobal({ g: 2 })],
  ])('reports unknown-state instead of a rollback for single-layout %s and rejects later calls', async (_name, write) => {
    const root = await freshRoot()
    const { backend, unit } = await open(single, root)
    await unit.putRecord('t', 'k', { v: 1 })
    gates.failSync = true

    await expect(write(unit)).rejects.toMatchObject({ name: 'StorageError', code: 'unknown-state' })
    gates.failSync = false
    expect(await readFile(join(root, 'single.json'), 'utf8')).toContain(_name === 'putRecord' ? '"v": 2' : '"g": 2')
    await expect(unit.putRecord('t', 'other', { v: 3 })).rejects.toMatchObject({ code: 'unknown-state' })
    await expect(unit.loadAll()).rejects.toMatchObject({ code: 'unknown-state' })
    await backend.close()
    expect(await readdir(root)).toEqual(['single.json'])
  })

  it('keeps a later write from republishing the pre-failure snapshot over the visible document', async () => {
    const root = await freshRoot()
    const { backend, unit } = await open(single, root)
    await unit.putRecord('t', 'k', { v: 1 })
    gates.failSync = true
    await expect(unit.putRecord('t', 'k', { v: 2 })).rejects.toMatchObject({ code: 'unknown-state' })
    gates.failSync = false

    await expect(unit.putRecord('t', 'k', { v: 3 })).rejects.toMatchObject({ code: 'unknown-state' })
    await backend.close()
    const reopened = await open(single, root)
    expect((await reopened.unit.loadAll()).tables.t).toEqual({ k: { v: 2 } })
    await reopened.backend.close()
  })

  it.each([
    ['putRecord', (unit: KvUnit) => unit.putRecord('t', 'k', { v: 2 }), join('perrecord', 't', 'k.json'), '"v": 2'],
    ['setGlobal', (unit: KvUnit) => unit.setGlobal({ g: 2 }), join('perrecord', 'global.json'), '"g": 2'],
  ])('reports unknown-state for per-record %s and rejects later calls', async (_name, write, file, text) => {
    const root = await freshRoot()
    const { backend, unit } = await open(perRecord, root)
    await unit.putRecord('t', 'k', { v: 1 })
    gates.failSync = true

    await expect(write(unit)).rejects.toMatchObject({ name: 'StorageError', code: 'unknown-state' })
    gates.failSync = false
    expect(await readFile(join(root, file), 'utf8')).toContain(text)
    await expect(unit.putRecord('t', 'other', { v: 3 })).rejects.toMatchObject({ code: 'unknown-state' })
    await backend.close()
  })

  it('still rolls back and stays usable when the failure happens before the rename', async () => {
    const root = await freshRoot()
    const { backend, unit } = await open(single, root)
    await unit.putRecord('t', 'k', { v: 1 })
    await rm(join(root, 'single.json'))
    await rm(root, { recursive: true })

    await expect(unit.putRecord('t', 'k', { v: 2 })).rejects.not.toMatchObject({ code: 'unknown-state' })
    expect((await unit.loadAll()).tables.t).toEqual({ k: { v: 1 } })
    await backend.close()
  })
})

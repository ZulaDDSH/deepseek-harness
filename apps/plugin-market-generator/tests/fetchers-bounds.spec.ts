import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { create as createTar } from 'tar'
import { afterEach, expect, it, vi } from 'vitest'
import { npmPackument, npmTarball } from '../src/fetchers.ts'
import { metricReader } from '../src/metrics.ts'
import type { GeneratedEntry } from '../src/generate.ts'

const dirs: string[] = []
afterEach(() => {
  vi.unstubAllGlobals()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

async function pack(files: Record<string, string | Uint8Array>): Promise<Buffer> {
  const dir = mkdtempSync(join(tmpdir(), 'market-bounds-'))
  dirs.push(dir)
  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(join(dir, 'package', path, '..'), { recursive: true })
    writeFileSync(join(dir, 'package', path), contents)
  }
  await createTar({ gzip: true, cwd: dir, file: join(dir, 'out.tgz'), portable: true }, ['package'])
  return readFileSync(join(dir, 'out.tgz'))
}

function endless(state: { cancelled: boolean; pulls: number }): Response {
  return new Response(new ReadableStream<Uint8Array>({
    pull(controller) { state.pulls += 1; controller.enqueue(new Uint8Array(1024 * 1024).fill(32)) },
    cancel() { state.cancelled = true },
  }))
}

const limits = { timeoutMs: 5000, maxTarballBytes: 1 << 20 }

it('rejects a compressed tarball whose skipped node_modules entry inflates past the unpacked limit', async () => {
  const tarball = await pack({
    'package.json': JSON.stringify({ name: 'dsh-skip', version: '1.0.0' }),
    'node_modules/big/zeros.bin': new Uint8Array(8 << 20),
  })
  expect(tarball.length).toBeLessThan(limits.maxTarballBytes)
  vi.stubGlobal('fetch', vi.fn(async () => new Response(tarball)))
  const integrity = `sha512-${createHash('sha512').update(tarball).digest('base64')}`
  await expect(npmTarball('dsh-skip', '1.0.0', { tarball: 'https://registry.example/t.tgz', integrity }, limits))
    .rejects.toThrow(`dsh-skip@1.0.0: unpacked tarball exceeds ${1 << 20} bytes`)
})

it('rejects an endless or oversized registry document without buffering it', async () => {
  const state = { cancelled: false, pulls: 0 }
  vi.stubGlobal('fetch', vi.fn(async () => endless(state)))
  await expect(npmPackument('https://registry.example/', 'dsh-big', { ...limits, maxMetadataBytes: 4096 }))
    .rejects.toThrow('dsh-big: response exceeds 4096 bytes')
  expect(state.cancelled).toBe(true)
  expect(state.pulls).toBeLessThanOrEqual(3)
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { headers: { 'content-length': '999999' } })))
  await expect(npmPackument('https://registry.example/', 'dsh-big', { ...limits, maxMetadataBytes: 4096 }))
    .rejects.toThrow('dsh-big: response exceeds 4096 bytes')
})

it('omits a metric whose response exceeds the byte limit and names the metric URL', async () => {
  const state = { cancelled: false, pulls: 0 }
  vi.stubGlobal('fetch', vi.fn(async () => endless(state)))
  const warn = vi.fn()
  const entry: GeneratedEntry = { name: 'dsh-x', versions: [{ version: '1.0.0', publishTimestamp: 0, source: { type: 'npm' } }] }
  expect(await metricReader(limits, 'https://registry.npmjs.org/', warn)(entry)).toEqual(entry)
  expect(warn).toHaveBeenCalledOnce()
  expect(warn.mock.calls[0]?.[0]).toContain('https://api.npmjs.org/downloads/point/last-week/dsh-x')
  expect(warn.mock.calls[0]?.[0]).toContain('response exceeds')
  expect(state.cancelled).toBe(true)
  expect(state.pulls).toBeLessThanOrEqual(3)
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { credentialKey, credentialRef } from '@deepseek-ai/dsh-credentials'
import { LocalCredentialProvider } from '../src/index.ts'

const hook = vi.hoisted(() => ({ afterRead: undefined as undefined | (() => Promise<void>) }))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  const wrapped = (async (...args: Parameters<typeof actual.readFile>) => {
    const result = await actual.readFile(...args)
    const run = hook.afterRead
    if (run !== undefined && String(args[0]).endsWith('.credentials.yaml')) {
      hook.afterRead = undefined
      await run()
    }
    return result
  }) as typeof actual.readFile
  return { ...actual, default: { ...actual, readFile: wrapped }, readFile: wrapped }
})

const ALPHA = credentialRef('DSH_EXT_ALPHA')
const BETA = credentialRef('DSH_EXT_BETA')
const KEY = credentialKey('llm-pi-ai', 'oauth')

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  hook.afterRead = undefined
  while (cleanups.length > 0) await cleanups.pop()!()
})

async function setup(): Promise<{ ctx: Context, path: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-cred-ext-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  const path = join(dir, '.credentials.yaml')
  const ctx = new Context()
  const fiber = ctx.plugin(LocalCredentialProvider, { path, watch: false })
  cleanups.push(async () => { await fiber.dispose() })
  await fiber
  return { ctx, path }
}

describe('external edit between the provider read and its replace', () => {
  it('keeps an editor save that lands after a reference write read the file', async () => {
    const { ctx, path } = await setup()
    await ctx.credentials.set(ALPHA, 'one')
    hook.afterRead = () => writeFile(path, `version: 1\nrefs:\n  ${ALPHA}: one\n  ${BETA}: external\n`, { mode: 0o600 })
    await ctx.credentials.set(ALPHA, 'two')
    const text = await readFile(path, 'utf8')
    expect(text).toContain(`${BETA}: external`)
    expect(text).toContain(`${ALPHA}: two`)
  })

  it('keeps an editor save that lands during a slow record mutation', async () => {
    const { ctx, path } = await setup()
    await ctx.credentials.set(ALPHA, 'one')
    await ctx.credentials.modifyRecord(KEY, () => Promise.resolve({ kind: 'api-key', key: 'x' }))
    const other = credentialKey('llm-pi-ai', 'other')
    await ctx.credentials.modifyRecord(other, async () => {
      const text = await readFile(path, 'utf8')
      await writeFile(path, text.replace(`${ALPHA}: one`, `${ALPHA}: edited`), { mode: 0o600 })
      return { kind: 'api-key', key: 'y' }
    })
    const text = await readFile(path, 'utf8')
    expect(text).toContain(`${ALPHA}: edited`)
    expect(text).toContain('key: y')
  })

  it('refuses to apply a mutation computed from a record the editor changed meanwhile', async () => {
    const { ctx, path } = await setup()
    await ctx.credentials.modifyRecord(KEY, () => Promise.resolve({ kind: 'api-key', key: 'x' }))
    await expect(ctx.credentials.modifyRecord(KEY, async () => {
      const text = await readFile(path, 'utf8')
      await writeFile(path, text.replace('key: x', 'key: hand-edited'), { mode: 0o600 })
      return { kind: 'api-key', key: 'refreshed' }
    })).rejects.toThrow(/edited in .* while it was being updated/)
    expect(await readFile(path, 'utf8')).toContain('key: hand-edited')
  })

  it('keeps an editor save that lands after a record delete read the file', async () => {
    const { ctx, path } = await setup()
    await ctx.credentials.set(ALPHA, 'one')
    await ctx.credentials.modifyRecord(KEY, () => Promise.resolve({ kind: 'api-key', key: 'x' }))
    hook.afterRead = async () => {
      const text = await readFile(path, 'utf8')
      await writeFile(path, text.replace(`${ALPHA}: one`, `${ALPHA}: edited`), { mode: 0o600 })
    }
    await ctx.credentials.deleteRecord(KEY)
    const text = await readFile(path, 'utf8')
    expect(text).toContain(`${ALPHA}: edited`)
    expect(text).not.toContain('key: x')
  })
})

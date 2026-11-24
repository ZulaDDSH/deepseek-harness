import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { AttachmentError, AttachmentStore } from '@deepseek-ai/dsh-attachment'
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

class StubStore extends AttachmentStore {
  override readonly imageLimits = { maxImagesPerMessage: 1, maxMessageImageBytes: 1, mediaTypes: [] } as never
  readonly seen: Array<{ path: string; maxBytes: number }> = []
  outcome: () => Promise<Uint8Array | undefined> = () => Promise.resolve(undefined)

  override validateImage(): Promise<void> {
    return Promise.resolve()
  }

  override saveImage(): Promise<never> {
    return Promise.reject(new Error('unused'))
  }

  override readImage(): Promise<never> {
    return Promise.reject(new Error('unused'))
  }

  override readHostFile(path: string, maxBytes: number): Promise<Uint8Array | undefined> {
    this.seen.push({ path, maxBytes })
    return this.outcome()
  }
}

let dir: string
let ctx: Context
let store: StubStore
let fs: LocalFileSystem

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dsh-fs-verified-'))
  ctx = new Context()
  store = new StubStore(ctx)
  await ctx.plugin(LocalFileSystem, { cwd: dir })
  fs = ctx.fs as LocalFileSystem
  await writeFile(join(dir, 'plain.txt'), 'on disk')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function drain(stream: AsyncIterable<string>): Promise<string> {
  let text = ''
  for await (const part of stream) text += part
  return text
}

describe('verified stored-attachment reads', () => {
  it('serves text and byte reads from the verified bytes instead of the path', async () => {
    store.outcome = () => Promise.resolve(Buffer.from('verified bytes'))
    const target = await fs.resolve('plain.txt')

    await expect(fs.readText(target)).resolves.toBe('verified bytes')
    await expect(drain(await fs.streamText(target))).resolves.toBe('verified bytes')
    await expect(fs.readBytes(target, undefined, 1024)).resolves.toEqual(Buffer.from('verified bytes'))
    await expect(fs.readByteRange(target, { offset: 2, length: 4 })).resolves.toEqual(Buffer.from('rifi'))
    expect(store.seen.map(call => call.path)).toEqual(Array(4).fill(target.targetKey))
    expect(store.seen[2]?.maxBytes).toBe(1024)
  })

  it('falls back to the plain read when the store does not claim the path', async () => {
    const target = await fs.resolve('plain.txt')

    await expect(fs.readText(target)).resolves.toBe('on disk')
    await expect(fs.readBytes(target, undefined, 1024)).resolves.toEqual(Buffer.from('on disk'))
  })

  it('refuses a stored file that failed verification instead of reading the path', async () => {
    store.outcome = () => Promise.reject(new AttachmentError('Stored attachment failed integrity verification.', 'ATTACHMENT_CORRUPT'))
    const target = await fs.resolve('plain.txt')

    await expect(fs.readText(target)).rejects.toMatchObject({ code: 'FS_IO_ERROR' })
    await expect(fs.readBytes(target, undefined, 1024)).rejects.toMatchObject({ code: 'FS_IO_ERROR' })
    await expect(fs.readByteRange(target, { offset: 0, length: 1 })).rejects.toMatchObject({ code: 'FS_IO_ERROR' })
    await expect(fs.streamText(target)).rejects.toMatchObject({ code: 'FS_IO_ERROR' })
  })

  it('maps missing and oversized stored files to the matching filesystem codes', async () => {
    const target = await fs.resolve('plain.txt')
    store.outcome = () => Promise.reject(new AttachmentError('missing', 'ATTACHMENT_NOT_FOUND'))
    await expect(fs.readBytes(target, undefined, 1024)).rejects.toMatchObject({ code: 'FS_NOT_FOUND' })
    store.outcome = () => Promise.reject(new AttachmentError('big', 'FILE_TOO_LARGE'))
    await expect(fs.readBytes(target, undefined, 1024)).rejects.toMatchObject({ code: 'FS_TOO_LARGE' })
  })

  it('reads the path directly when no attachment service is mounted', async () => {
    const bare = new Context()
    await bare.plugin(LocalFileSystem, { cwd: dir })
    const target = await (bare.fs as LocalFileSystem).resolve('plain.txt')

    await expect((bare.fs as LocalFileSystem).readText(target)).resolves.toBe('on disk')
  })
})

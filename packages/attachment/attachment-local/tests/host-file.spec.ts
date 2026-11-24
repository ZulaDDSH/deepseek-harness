import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import LocalAttachmentStore from '../src/index.ts'
import { storedFilePath } from '../src/file-store.ts'

const homes: string[] = []

async function service(maxHostPathVerifyBytes?: number): Promise<LocalAttachmentStore> {
  const home = await mkdtemp(join(tmpdir(), 'dsh-host-file-'))
  homes.push(home)
  return new LocalAttachmentStore(new Context(), {
    dshHome: home,
    ...maxHostPathVerifyBytes === undefined ? {} : { maxHostPathVerifyBytes },
  })
}

afterEach(async () => {
  await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true, maxRetries: 3 })))
})

describe('verified host file reads', () => {
  it('answers undefined for a path outside the store', async () => {
    const store = await service()
    await expect(store.readHostFile(join(tmpdir(), 'elsewhere.txt'), 1024)).resolves.toBeUndefined()
    await expect(store.readHostFile(join(store.root, 'tmp', 'x'), 1024)).resolves.toBeUndefined()
    await expect(store.readHostFile(join(store.root, 'files', 'aa', 'a'.repeat(64)), 1024)).resolves.toBeUndefined()
    await expect(store.readHostFile(join(store.root, 'files', 'bb', 'a'.repeat(64), 'n'), 1024)).resolves.toBeUndefined()
  })

  it('returns verified bytes for a stored alias, a handoff copy, and a stored image object', async () => {
    const store = await service()
    const data = Uint8Array.of(1, 2, 3, 4)
    const ref = await store.saveFile({ data, name: 'a.bin' })
    const alias = storedFilePath(store.root, ref)
    const copy = store.fileHostPath(ref)!
    const png = new Uint8Array(await sharp({
      create: { width: 2, height: 2, channels: 3, background: { r: 1, g: 2, b: 3 } },
    }).png().toBuffer())
    const image = await store.saveImage({ data: png, mediaType: 'image/png' })

    await expect(store.readHostFile(alias, 1024)).resolves.toEqual(Buffer.from(data))
    await expect(store.readHostFile(copy, 1024)).resolves.toEqual(Buffer.from(data))
    await expect(store.readHostFile(join(store.root, 'objects', String(image.attachmentId).slice(7, 9), String(image.attachmentId).slice(7)), 1 << 20))
      .resolves.toEqual(Buffer.from((await store.readImage(image)).data))
    await expect(store.readHostFile(store.imageHostPath(image)!, 1 << 20))
      .resolves.toEqual(Buffer.from((await store.readImage(image)).data))
  })

  it('rejects a stored file rewritten at the same length', async () => {
    const store = await service()
    const ref = await store.saveFile({ data: Uint8Array.of(1, 2, 3, 4), name: 'a.bin' })
    const alias = storedFilePath(store.root, ref)
    await chmod(alias, 0o600)
    await writeFile(alias, Uint8Array.of(9, 9, 9, 9))

    await expect(store.readHostFile(alias, 1024)).rejects.toMatchObject({ code: 'ATTACHMENT_CORRUPT' })
  })

  it('rejects a missing, truncated, or oversized stored file instead of reading it unverified', async () => {
    const store = await service()
    const ref = await store.saveFile({ data: Uint8Array.of(1, 2, 3, 4), name: 'a.bin' })
    const alias = storedFilePath(store.root, ref)

    await expect(store.readHostFile(alias, 3)).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' })
    await chmod(alias, 0o600)
    await writeFile(alias, Uint8Array.of(1, 2))
    await expect(store.readHostFile(alias, 1024)).rejects.toMatchObject({ code: 'ATTACHMENT_CORRUPT' })
    await rm(alias)
    await expect(store.readHostFile(alias, 1024)).rejects.toMatchObject({ code: 'ATTACHMENT_NOT_FOUND' })
  })

  it('applies the store verification limit to readers that accept more', async () => {
    const store = await service(2)
    const ref = await store.saveFile({ data: Uint8Array.of(1, 2, 3, 4), name: 'a.bin' })

    await expect(store.readHostFile(storedFilePath(store.root, ref), 1 << 30)).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' })
  })
})

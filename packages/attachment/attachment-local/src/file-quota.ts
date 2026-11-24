import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { AttachmentError } from '@deepseek-ai/dsh-attachment'

async function directoryBytes(path: string): Promise<number> {
  let total = 0
  let entries
  try {
    entries = await readdir(path, { withFileTypes: true })
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return 0
    throw error
  }
  for (const entry of entries) {
    const child = join(path, entry.name)
    total += entry.isDirectory() ? await directoryBytes(child) : (await stat(child)).size
  }
  return total
}

export class FileStoreQuota {
  private usedBytes = 0
  private reservedBytes = 0
  private loaded: Promise<void> | undefined

  constructor(
    private readonly root: string,
    readonly maxFileBytes: number,
    readonly maxStoredBytes: number,
  ) {}

  async reserve(already: number, bytes: number): Promise<void> {
    if (already + bytes > this.maxFileBytes) {
      throw new AttachmentError('File exceeds the configured byte limit.', 'FILE_TOO_LARGE')
    }
    this.loaded ??= directoryBytes(join(this.root, 'file-objects')).then((total) => {
      this.usedBytes += total
    }, (error: unknown) => {
      this.loaded = undefined
      throw error
    })
    await this.loaded
    if (this.usedBytes + this.reservedBytes + bytes > this.maxStoredBytes) {
      throw new AttachmentError('The file store has reached its configured size limit.', 'FILE_STORE_FULL')
    }
    this.reservedBytes += bytes
  }

  settle(reserved: number, newObjectBytes: number): void {
    this.reservedBytes -= reserved
    this.usedBytes += newObjectBytes
  }

  async *meter(data: AsyncIterable<Uint8Array>, progress: { reserved: number }): AsyncIterable<Uint8Array> {
    for await (const chunk of data) {
      await this.reserve(progress.reserved, chunk.byteLength)
      progress.reserved += chunk.byteLength
      yield chunk
    }
  }
}

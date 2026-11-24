/** Verbatim content-addressed local file storage. @module @deepseek-ai/dsh-attachment-local/file-store */

import { createHash } from 'node:crypto'
import type { Stats } from 'node:fs'
import {
  closeSync, createReadStream, existsSync, openSync, readSync, statSync,
} from 'node:fs'
import { join } from 'node:path'
import { AttachmentError } from '@deepseek-ai/dsh-attachment'
import type { AttachmentId } from '@deepseek-ai/dsh-attachment/types'
import { brandString } from '@deepseek-ai/dsh-brand'
import type {
  FileAttachmentRef, SaveFileAttachment, SaveFileStreamAttachment,
} from '@deepseek-ai/dsh-attachment'
import type { FileStoreQuota } from './file-quota.ts'
import {
  publishImmutableAlias, publishImmutableObject, publishImmutableObjectStream,
} from './store.ts'
import type { StreamedImmutableObject } from './store.ts'

const FILE_ID_PATTERN = /^sha256:([a-f0-9]{64})$/
const WINDOWS_DEVICE_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu

function isWindowsDeviceName(name: string): boolean {
  const dot = name.indexOf('.')
  const stem = (dot < 0 ? name : name.slice(0, dot)).replace(/[. ]+$/u, '')
  return WINDOWS_DEVICE_NAME.test(stem)
}

function utf8Prefix(value: string, maxBytes: number): string {
  let bytes = 0
  let prefix = ''
  for (const character of Buffer.from(value).toString('utf8')) {
    const characterBytes = Buffer.byteLength(character)
    if (bytes + characterBytes > maxBytes) break
    prefix += character
    bytes += characterBytes
  }
  return prefix
}

/**
 * Sanitize one caller display name into a safe stored leaf name. Both
 * separator styles are stripped by hand: a POSIX host treats `\` as an
 * ordinary character, so path.basename would keep a Windows client's full
 * local path and leak it into the reference and the session log. Characters
 * Windows refuses in file names become `_` so one reference stays valid on
 * every supported host.
 * @param value - caller-declared display name, possibly a full client path.
 * @returns a non-empty leaf name safe to store on every supported filesystem.
 */
export function fileLeafName(value: string | undefined): string {
  if (value === undefined) return 'file'
  const leaf = value.slice(Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\')) + 1)
  let clean = leaf
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[<>:"|?*]/g, '_')
    .trim()
    .replace(/[. ]+$/u, '')
  if (isWindowsDeviceName(clean)) clean = `_${clean}`
  clean = utf8Prefix(clean, 255).replace(/[. ]+$/u, '')
  return clean === '' || clean === '.' || clean === '..' ? 'file' : clean
}

function ensureFileReference(ref: FileAttachmentRef): string {
  const match = FILE_ID_PATTERN.exec(String(ref.attachmentId))
  if (match?.[1] === undefined || ref.name !== fileLeafName(ref.name)) {
    throw new AttachmentError('File attachment reference is invalid.', 'INVALID_ATTACHMENT_REF')
  }
  return match[1]
}

/**
 * Derive the absolute immutable-object path for one stored file. The digest
 * names a directory so the sanitized display name stays the stored leaf name,
 * giving models and users a path that ends in the real filename.
 * @param root - absolute `DSH_HOME/attachments/v1` root.
 * @param ref - durable file reference from the session log or an upload receipt.
 * @returns provider-local path without reading the object.
 * @throws an AttachmentError when the reference digest or name is invalid.
 */
export function storedFilePath(root: string, ref: FileAttachmentRef): string {
  const sha256 = ensureFileReference(ref)
  return join(root, 'files', sha256.slice(0, 2), sha256, ref.name)
}

/** Canonical object path shared by every display name for one digest. */
function storedFileObjectPath(root: string, sha256: string): string {
  return join(root, 'file-objects', sha256.slice(0, 2), sha256)
}

/**
 * Commit one file byte-for-byte below a versioned attachment root.
 * @param root - absolute `DSH_HOME/attachments/v1` root.
 * @param input - exact bytes and optional display name.
 * @returns the durable content-addressed file reference.
 */
export async function saveFileVerbatim(
  root: string,
  input: SaveFileAttachment,
  quota?: FileStoreQuota,
): Promise<FileAttachmentRef> {
  const sha256 = createHash('sha256').update(input.data).digest('hex')
  const ref: FileAttachmentRef = {
    attachmentId: brandString<AttachmentId>(`sha256:${sha256}`),
    name: fileLeafName(input.name),
    bytes: input.data.byteLength,
  }
  const objectPath = storedFileObjectPath(root, sha256)
  const isNew = !existsSync(objectPath)
  if (isNew) await quota?.reserve(0, ref.bytes)
  let stored = 0
  try {
    await publishImmutableObject(root, objectPath, input.data, sha256)
    if (isNew) stored = ref.bytes
    await publishImmutableAlias(root, objectPath, storedFilePath(root, ref), sha256)
  } finally {
    if (isNew) quota?.settle(ref.bytes, stored)
  }
  return ref
}

/**
 * Commit one file byte-for-byte from bounded chunks below a versioned attachment root.
 * @param root - absolute `DSH_HOME/attachments/v1` root.
 * @param input - ordered exact bytes, optional cancellation, and display name.
 * @returns the durable content-addressed file reference.
 */
export async function saveFileStreamVerbatim(
  root: string,
  input: SaveFileStreamAttachment,
  quota?: FileStoreQuota,
): Promise<FileAttachmentRef> {
  const name = fileLeafName(input.name)
  const progress = { reserved: 0, isNew: false }
  let stored: StreamedImmutableObject | undefined
  try {
    stored = await publishImmutableObjectStream(
      root,
      quota === undefined ? input.data : quota.meter(input.data, progress),
      (sha256) => {
        const path = storedFileObjectPath(root, sha256)
        progress.isNew = !existsSync(path)
        return path
      },
      input.signal,
    )
  } finally {
    quota?.settle(progress.reserved, stored !== undefined && progress.isNew ? stored.bytes : 0)
  }
  const ref: FileAttachmentRef = {
    attachmentId: brandString<AttachmentId>(`sha256:${stored.sha256}`),
    name,
    bytes: stored.bytes,
  }
  input.signal?.throwIfAborted()
  await publishImmutableAlias(
    root,
    storedFileObjectPath(root, stored.sha256),
    storedFilePath(root, ref),
    stored.sha256,
  )
  input.signal?.throwIfAborted()
  return ref
}

/**
 * Read one stored file in bounded chunks and verify its byte count and digest.
 * @param root - absolute `DSH_HOME/attachments/v1` root.
 * @param ref - durable file reference from the session log.
 * @param signal - optional cancellation for filesystem reads.
 * @returns exact stored bytes in order; integrity failures reject after the final chunk.
 */
export async function* readFileStreamVerbatim(
  root: string,
  ref: FileAttachmentRef,
  signal?: AbortSignal,
): AsyncIterable<Uint8Array> {
  signal?.throwIfAborted()
  const sha256 = ensureFileReference(ref)
  const stream = createReadStream(storedFilePath(root, ref), {
    highWaterMark: 1 << 16,
    ...(signal === undefined ? {} : { signal }),
  })
  const hash = createHash('sha256')
  let bytes = 0
  try {
    for await (const chunk of stream) {
      signal?.throwIfAborted()
      const data = chunk as Buffer
      hash.update(data)
      bytes += data.byteLength
      yield data
    }
  } catch (error) {
    signal?.throwIfAborted()
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      throw new AttachmentError('File attachment object is missing.', 'ATTACHMENT_NOT_FOUND')
    }
    throw new AttachmentError('Unable to read file attachment.', 'ATTACHMENT_READ_FAILED', { cause: error })
  } finally {
    stream.destroy()
  }
  signal?.throwIfAborted()
  if (bytes !== ref.bytes || hash.digest('hex') !== sha256) {
    throw new AttachmentError('Stored file attachment failed integrity verification.', 'ATTACHMENT_CORRUPT')
  }
}

const VERIFIED_HOST_PATH_LIMIT = 512
// constraint: fileHostPath is synchronous, so unverified files above this size get no host path; read them with readFileStream.
export const MAX_SYNC_VERIFY_BYTES = 64 * 1024 * 1024
const verifiedHostPathIdentities = new Map<string, string>()

function storedFileIdentity(stat: Stats): string {
  return [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs].join(':')
}

function digestFileSync(path: string): { sha256: string, bytes: number } {
  const fd = openSync(path, 'r')
  try {
    const hash = createHash('sha256')
    const buffer = Buffer.allocUnsafe(1 << 16)
    let bytes = 0
    for (;;) {
      const read = readSync(fd, buffer, 0, buffer.length, null)
      if (read === 0) break
      hash.update(buffer.subarray(0, read))
      bytes += read
    }
    return { sha256: hash.digest('hex'), bytes }
  } finally {
    closeSync(fd)
  }
}

export function verifiedStoredFilePath(root: string, ref: FileAttachmentRef): string | undefined {
  const path = storedFilePath(root, ref)
  const sha256 = ensureFileReference(ref)
  let stat: Stats
  try {
    stat = statSync(path)
  } catch {
    verifiedHostPathIdentities.delete(path)
    return undefined
  }
  if (!stat.isFile() || stat.size !== ref.bytes) {
    verifiedHostPathIdentities.delete(path)
    return undefined
  }
  const identity = storedFileIdentity(stat)
  if (verifiedHostPathIdentities.get(path) === identity) return path
  if (stat.size > MAX_SYNC_VERIFY_BYTES) return undefined
  let digest: { sha256: string, bytes: number }
  try {
    digest = digestFileSync(path)
  } catch {
    verifiedHostPathIdentities.delete(path)
    return undefined
  }
  if (digest.bytes !== ref.bytes || digest.sha256 !== sha256) {
    verifiedHostPathIdentities.delete(path)
    return undefined
  }
  if (verifiedHostPathIdentities.size >= VERIFIED_HOST_PATH_LIMIT) verifiedHostPathIdentities.clear()
  verifiedHostPathIdentities.set(path, identity)
  return path
}

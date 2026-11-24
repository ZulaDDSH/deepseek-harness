import { createHash, randomUUID } from 'node:crypto'
import type { Stats } from 'node:fs'
import {
  chmodSync, closeSync, fstatSync, mkdirSync, openSync, readSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync,
} from 'node:fs'
import { open } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { AttachmentError } from '@deepseek-ai/dsh-attachment'
import type { FileAttachmentRef, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { ensureFileReference, storedFilePath } from './file-store.ts'
import { ensureReference, normalizedImagePath, ownerIsAlive } from './store.ts'

const HANDOFF_IDENTITY_LIMIT = 512
const handoffIdentities = new Map<string, string>()
const liveHandoffDirectories = new Set<string>()
const HEX_DIGEST = /^[a-f0-9]{64}$/
const HANDOFF_OWNER = /^(\d{1,10})-[0-9a-f-]{36}$/

function identityOf(stat: Stats): string {
  return [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs].join(':')
}

function openIdentity(target: string, bytes: number): string | undefined {
  let fd: number
  try {
    fd = openSync(target, 'r')
  } catch {
    return undefined
  }
  try {
    const stat = fstatSync(fd)
    return stat.isFile() && stat.size === bytes ? identityOf(stat) : undefined
  } finally {
    closeSync(fd)
  }
}

function copyVerified(source: string, target: string, sha256: string, bytes: number): boolean {
  const temporary = `${target}.${randomUUID()}.tmp`
  let input: number | undefined
  let output: number | undefined
  try {
    input = openSync(source, 'r')
    const stat = fstatSync(input)
    if (!stat.isFile() || stat.size !== bytes) return false
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 })
    output = openSync(temporary, 'wx', 0o600)
    const hash = createHash('sha256')
    const buffer = Buffer.allocUnsafe(1 << 16)
    let copied = 0
    for (;;) {
      const read = readSync(input, buffer, 0, buffer.length, null)
      if (read === 0) break
      const chunk = buffer.subarray(0, read)
      hash.update(chunk)
      writeFileSync(output, chunk)
      copied += read
    }
    closeSync(output)
    output = undefined
    if (copied !== bytes || hash.digest('hex') !== sha256) {
      rmSync(temporary, { force: true })
      return false
    }
    chmodSync(temporary, 0o400)
    rmSync(target, { force: true })
    renameSync(temporary, target)
    return true
  } catch {
    if (output !== undefined) closeSync(output)
    output = undefined
    rmSync(temporary, { force: true })
    return false
  } finally {
    if (input !== undefined) closeSync(input)
  }
}

const IMAGE_EXTENSIONS: Readonly<Record<ImageAttachmentRef['mediaType'], string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

function handoffObject(
  source: string,
  target: string,
  sha256: string,
  bytes: number,
  maxBytes: number,
  directory: string,
): string | undefined {
  if (bytes > maxBytes) return undefined
  const current = openIdentity(target, bytes)
  if (current !== undefined && handoffIdentities.get(target) === current) return target
  handoffIdentities.delete(target)
  liveHandoffDirectories.add(directory)
  if (!copyVerified(source, target, sha256, bytes)) return undefined
  const identity = openIdentity(target, bytes)
  if (identity === undefined) return undefined
  if (handoffIdentities.size >= HANDOFF_IDENTITY_LIMIT) handoffIdentities.clear()
  handoffIdentities.set(target, identity)
  return target
}

export function handoffStoredFile(
  root: string,
  ref: FileAttachmentRef,
  maxBytes: number,
  directory: string,
): string | undefined {
  const sha256 = ensureFileReference(ref)
  return handoffObject(storedFilePath(root, ref), join(directory, sha256, ref.name), sha256, ref.bytes, maxBytes, directory)
}

export function handoffStoredImage(
  root: string,
  ref: ImageAttachmentRef,
  maxBytes: number,
  directory: string,
): string | undefined {
  const sha256 = ensureReference(ref)
  const target = join(directory, sha256, `${sha256}.${IMAGE_EXTENSIONS[ref.mediaType]}`)
  return handoffObject(normalizedImagePath(root, ref), target, sha256, ref.bytes, maxBytes, directory)
}

export function releaseHandoffs(directory: string): void {
  for (const path of handoffIdentities.keys()) {
    if (path.startsWith(directory + sep)) handoffIdentities.delete(path)
  }
  liveHandoffDirectories.delete(directory)
  rmSync(directory, { recursive: true, force: true })
}

export function reclaimAbandonedHandoffs(handoffRoot: string): void {
  let names: string[]
  try {
    names = readdirSync(handoffRoot)
  } catch {
    return
  }
  for (const name of names) {
    const owner = HANDOFF_OWNER.exec(name)?.[1]
    if (owner === undefined) continue
    const pid = Number(owner)
    const path = join(handoffRoot, name)
    if (liveHandoffDirectories.has(path)) continue
    if (pid === process.pid || !ownerIsAlive(pid)) rmSync(path, { recursive: true, force: true })
  }
}

function fold(path: string): string {
  return process.platform === 'win32' ? path.toLowerCase() : path
}

const PATH_SHAPES: Readonly<Record<string, { parts: number; digest: number }>> = {
  objects: { parts: 3, digest: 2 },
  'file-objects': { parts: 3, digest: 2 },
  files: { parts: 4, digest: 2 },
  handoff: { parts: 4, digest: 2 },
}

function digestAt(root: string, resolved: string): string | undefined {
  const parts = relative(fold(resolve(root)), resolved).split(sep)
  const shape = PATH_SHAPES[parts[0] ?? '']
  if (shape === undefined || parts.length !== shape.parts || isAbsolute(parts[1] ?? '')) return undefined
  const digest = parts[shape.digest]
  if (digest === undefined || !HEX_DIGEST.test(digest)) return undefined
  return parts[0] !== 'handoff' && parts[1] !== digest.slice(0, 2) ? undefined : digest
}

function hasStoredShape(segments: readonly string[]): boolean {
  return Object.entries(PATH_SHAPES).some(([kind, shape]) => {
    const start = segments.length - shape.parts
    return segments[start] === kind && HEX_DIGEST.test(segments[start + shape.digest] ?? '')
  })
}

function storedDigestOf(root: string, hostPath: string): string | undefined {
  const resolved = fold(resolve(hostPath))
  if (!hasStoredShape(resolved.split(sep))) return undefined
  const lexical = digestAt(root, resolved)
  if (lexical !== undefined) return lexical
  try {
    return digestAt(realpathSync(root), resolved)
  } catch {
    return undefined
  }
}

export async function readStoredHostFile(
  root: string,
  hostPath: string,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<Uint8Array | undefined> {
  const sha256 = storedDigestOf(root, hostPath)
  if (sha256 === undefined) return undefined
  signal?.throwIfAborted()
  let handle
  try {
    handle = await open(hostPath, 'r')
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      throw new AttachmentError('Stored attachment object is missing.', 'ATTACHMENT_NOT_FOUND')
    }
    throw new AttachmentError('Unable to read stored attachment object.', 'ATTACHMENT_READ_FAILED', { cause: error })
  }
  try {
    const stat = await handle.stat()
    if (stat.size > maxBytes) {
      throw new AttachmentError(`Stored attachment object exceeds the ${maxBytes}-byte verified read limit.`, 'FILE_TOO_LARGE')
    }
    const data = Buffer.allocUnsafe(stat.size)
    let length = 0
    while (length < data.length) {
      signal?.throwIfAborted()
      const { bytesRead } = await handle.read(data, length, data.length - length, length)
      if (bytesRead === 0) break
      length += bytesRead
    }
    const extra = await handle.read(Buffer.allocUnsafe(1), 0, 1, length)
    if (length !== data.length || extra.bytesRead !== 0
      || createHash('sha256').update(data).digest('hex') !== sha256) {
      throw new AttachmentError('Stored attachment failed integrity verification.', 'ATTACHMENT_CORRUPT')
    }
    return data
  } catch (error) {
    if (error instanceof AttachmentError || signal?.aborted === true) throw error
    throw new AttachmentError('Unable to read stored attachment object.', 'ATTACHMENT_READ_FAILED', { cause: error })
  } finally {
    await handle.close()
  }
}

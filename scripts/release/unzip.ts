import { createWriteStream } from 'node:fs'
import { chmod, lstat, mkdir, symlink } from 'node:fs/promises'
import type { Readable } from 'node:stream'
import { text } from 'node:stream/consumers'
import { pipeline } from 'node:stream/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { open, type Entry, type ZipFile } from 'yauzl'

const S_IFMT = 0o170000
const S_IFDIR = 0o040000
const S_IFLNK = 0o120000

/**
 * Extract a zip archive into an absolute directory, rejecting entries and symlinks that escape it.
 * @param archive - Zip archive to read.
 * @param options - Absolute destination directory, and an optional hook called before each entry whose throw aborts extraction.
 * @returns Resolves after every entry is written; rejects on the first invalid or failed entry after closing the archive.
 */
export async function extractZip(
  archive: string, options: { dir: string; onEntry?: (entry: { fileName: string }) => void },
): Promise<void> {
  if (!isAbsolute(options.dir)) throw new Error(`zip extraction: destination must be absolute: ${options.dir}`)
  const root = resolve(options.dir)
  await mkdir(root, { recursive: true })
  const zipfile = await new Promise<ZipFile>((resolveOpen, rejectOpen) => {
    open(archive, { lazyEntries: true }, (error, file) => { if (error) rejectOpen(error); else resolveOpen(file) })
  })
  await new Promise<void>((resolveEntries, rejectEntries) => {
    zipfile.on('error', (error: Error) => {
      zipfile.close()
      rejectEntries(error)
    })
    zipfile.on('end', resolveEntries)
    zipfile.on('entry', (entry: Entry) => {
      writeEntry(zipfile, entry, root, options.onEntry).then(() => { zipfile.readEntry() }, (error: unknown) => {
        zipfile.emit('error', error)
      })
    })
    zipfile.readEntry()
  })
}

async function writeEntry(
  zipfile: ZipFile, entry: Entry, root: string, onEntry: ((entry: { fileName: string }) => void) | undefined,
): Promise<void> {
  onEntry?.(entry)
  if (entry.fileName.startsWith('__MACOSX/')) return
  const destination = resolveEntry(root, entry.fileName)
  const mode = entry.externalFileAttributes >>> 16
  const type = mode & S_IFMT
  await assertNoSymlinkBetween(root, destination)
  if (entry.fileName.endsWith('/') || type === S_IFDIR) {
    await mkdir(destination, { recursive: true })
    return
  }
  if (type === S_IFLNK) {
    const target = await text(await openEntry(zipfile, entry))
    if (isAbsolute(target) || /^[A-Za-z]:/u.test(target) || !isContained(root, resolve(dirname(destination), target))) {
      throw new Error(`zip extraction: symlink escapes destination: ${entry.fileName} -> ${target}`)
    }
    await mkdir(dirname(destination), { recursive: true })
    await symlink(target, destination)
    return
  }
  await mkdir(dirname(destination), { recursive: true })
  await pipeline(await openEntry(zipfile, entry), createWriteStream(destination))
  if (process.platform !== 'win32' && (mode & 0o777) !== 0) await chmod(destination, mode & 0o777)
}

function openEntry(zipfile: ZipFile, entry: Entry): Promise<Readable> {
  return new Promise((resolveStream, rejectStream) => {
    zipfile.openReadStream(entry, (error, stream) => { if (error) rejectStream(error); else resolveStream(stream) })
  })
}

function resolveEntry(root: string, fileName: string): string {
  if (/\\|^\/|^[A-Za-z]:/u.test(fileName) || fileName.split('/').includes('..')) {
    throw new Error(`zip extraction: unsafe entry name: ${fileName}`)
  }
  const destination = resolve(root, fileName)
  if (!isContained(root, destination)) throw new Error(`zip extraction: entry escapes destination: ${fileName}`)
  return destination
}

function isContained(root: string, path: string): boolean {
  const rel = relative(root, path)
  return !isAbsolute(rel) && rel.split(sep)[0] !== '..'
}

async function assertNoSymlinkBetween(root: string, destination: string): Promise<void> {
  let current = root
  for (const part of relative(root, destination).split(sep).filter(Boolean)) {
    current = join(current, part)
    const stats = await lstat(current).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    })
    if (stats === null) return
    if (stats.isSymbolicLink()) throw new Error(`zip extraction: refusing to write through symlink: ${current}`)
  }
}

import { existsSync, mkdtempSync, rmSync, statSync, symlinkSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, readlink, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zipSync, type Zippable, type ZippableFile } from 'fflate'
import { expect, it } from 'vitest'
import { extractZip } from './unzip.ts'

const symlinkSupported = ((): boolean => {
  const probe = mkdtempSync(join(tmpdir(), 'unzip-probe-'))
  try {
    symlinkSync('target', join(probe, 'link'))
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPERM') return false
    throw error
  } finally {
    rmSync(probe, { recursive: true, force: true })
  }
})()

const text = (value: string): Uint8Array => new TextEncoder().encode(value)
const unix = (mode: number, value: string): ZippableFile => [text(value), { os: 3, attrs: mode << 16 }]

async function withArchive(files: Zippable, run: (paths: { root: string; archive: string; dest: string }) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'unzip-'))
  try {
    const archive = join(root, 'archive.zip')
    await writeFile(archive, zipSync(files))
    await run({ root, archive, dest: join(root, 'out') })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

it('extracts nested files and directories with their contents', async () => {
  await withArchive({ 'top.txt': text('top'), 'nested/deep/file.txt': text('deep'), 'empty/': new Uint8Array() }, async ({ archive, dest }) => {
    await extractZip(archive, { dir: dest })
    expect(await readFile(join(dest, 'top.txt'), 'utf8')).toBe('top')
    expect(await readFile(join(dest, 'nested/deep/file.txt'), 'utf8')).toBe('deep')
    expect(statSync(join(dest, 'empty')).isDirectory()).toBe(true)
  })
})

it('rejects a parent-directory entry without writing outside the destination', async () => {
  await withArchive({ '../evil.txt': text('x') }, async ({ root, archive, dest }) => {
    await expect(extractZip(archive, { dir: dest })).rejects.toThrow('../evil.txt')
    expect(existsSync(join(root, 'evil.txt'))).toBe(false)
  })
})

it('rejects a symlink entry pointing outside the destination', async () => {
  await withArchive({ link: unix(0o120777, '../../outside') }, async ({ archive, dest }) => {
    await expect(extractZip(archive, { dir: dest })).rejects.toThrow('symlink escapes destination')
    expect(await readdir(dest)).toEqual([])
  })
})

it('rejects a symlink entry with an absolute target', async () => {
  await withArchive({ link: unix(0o120777, '/etc') }, async ({ archive, dest }) => {
    await expect(extractZip(archive, { dir: dest })).rejects.toThrow('symlink escapes destination')
    expect(await readdir(dest)).toEqual([])
  })
})

it('rejects a file entry written through a symlink entry created earlier in the archive', async () => {
  await withArchive({ link: unix(0o120777, '..'), 'link/pwned.txt': text('x') }, async ({ root, archive, dest }) => {
    await expect(extractZip(archive, { dir: dest })).rejects.toThrow('symlink escapes destination')
    expect(existsSync(join(root, 'pwned.txt'))).toBe(false)
  })
})

it('refuses a file entry that would write through a symlink already in the destination', async () => {
  await withArchive({ 'link/pwned.txt': text('x') }, async ({ root, archive, dest }) => {
    const outside = join(root, 'outside')
    await mkdir(outside)
    await mkdir(dest)
    await symlink(outside, join(dest, 'link'), process.platform === 'win32' ? 'junction' : 'dir')
    await expect(extractZip(archive, { dir: dest })).rejects.toThrow('refusing to write through symlink')
    expect(existsSync(join(outside, 'pwned.txt'))).toBe(false)
  })
})

it.skipIf(process.platform === 'win32')('preserves the Unix mode of extracted files', async () => {
  await withArchive({ 'run.sh': unix(0o100755, 'echo hi') }, async ({ archive, dest }) => {
    await extractZip(archive, { dir: dest })
    expect(statSync(join(dest, 'run.sh')).mode & 0o777).toBe(0o755)
  })
})

it.skipIf(!symlinkSupported)('creates a relative symlink that stays inside the destination', async () => {
  await withArchive({ 'b/file': text('target'), 'a/link': unix(0o120777, '../b/file') }, async ({ archive, dest }) => {
    await extractZip(archive, { dir: dest })
    expect(await readlink(join(dest, 'a/link'))).toBe('../b/file')
    expect(await readFile(join(dest, 'a/link'), 'utf8')).toBe('target')
  })
})

it('aborts extraction when onEntry throws', async () => {
  await withArchive({ 'first.txt': text('1'), 'stop.txt': text('2'), 'after.txt': text('3') }, async ({ archive, dest }) => {
    await expect(extractZip(archive, {
      dir: dest,
      onEntry: ({ fileName }) => { if (fileName === 'stop.txt') throw new Error('stop requested') },
    })).rejects.toThrow('stop requested')
    expect(existsSync(join(dest, 'first.txt'))).toBe(true)
    expect(existsSync(join(dest, 'after.txt'))).toBe(false)
  })
})

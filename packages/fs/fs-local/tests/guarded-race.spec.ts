/** An external writer landing between the version check and publication must win over the harness. */
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { FsTarget } from '@deepseek-ai/dsh-fs'
import { parsePatch } from '@deepseek-ai/dsh-fs-patch'
import { describe, expect, it, onTestFinished } from 'vitest'
import { LocalFileSystem } from '../src/index.ts'

function hunks() {
  const [operation] = parsePatch('*** Begin Patch\n*** Update File: a\n@@\n-old\n+new\n*** End Patch')
  if (operation?.kind !== 'update') throw new Error('Expected update')
  return operation.hunks
}

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-guarded-race-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(LocalFileSystem, { cwd: root })
  const fs = ctx.fs as LocalFileSystem
  const file = async (name: string, content: string): Promise<FsTarget> => {
    await writeFile(join(root, name), content)
    return fs.resolve(name)
  }
  const version = async (target: FsTarget) => {
    const info = await fs.stat(target)
    if (!info) throw new Error('Expected file')
    return info.version
  }
  const external = (name: string) => async () => { await writeFile(join(root, name), 'external edit that is longer') }
  const bytes = (name: string) => readFile(join(root, name), 'utf8')
  return { fs, root, file, version, external, bytes }
}

describe('external edit between the version check and publication', () => {
  it('keeps the external file when a guarded write was staged from a stale version', async () => {
    const { fs, file, version, external, bytes } = await setup()
    const target = await file('a', 'old\n')
    fs.internals.inspectTemp = external('a')
    await expect(fs.writeText(target, 'agent', { kind: 'replaceIfVersion', version: await version(target) }))
      .rejects.toMatchObject({ code: 'FS_STALE_VERSION' })
    expect(await bytes('a')).toBe('external edit that is longer')
  })

  it.each([
    ['guarded', true],
    ['unconditional', false],
  ])('keeps the external file when a %s edit was staged from a stale read', async (_name, guarded) => {
    const { fs, file, version, external, bytes } = await setup()
    const target = await file('a', 'old\n')
    fs.internals.inspectTemp = external('a')
    const expected = guarded ? { version: await version(target) } : undefined
    await expect(fs.editText(target, { oldString: 'old', newString: 'new', replaceAll: false }, expected))
      .rejects.toMatchObject({ code: 'FS_STALE_VERSION' })
    expect(await bytes('a')).toBe('external edit that is longer')
  })

  it.each([
    ['guarded', true],
    ['unconditional', false],
  ])('keeps the external file when a %s append was staged from a stale read', async (_name, guarded) => {
    const { fs, file, version, external, bytes } = await setup()
    const target = await file('a', 'old\n')
    fs.internals.inspectTemp = external('a')
    const expected = guarded ? { version: await version(target) } : undefined
    await expect(fs.editText(target, { oldString: '', newString: 'tail\n', replaceAll: false, append: true }, expected))
      .rejects.toMatchObject({ code: 'FS_STALE_VERSION' })
    expect(await bytes('a')).toBe('external edit that is longer')
  })

  it('keeps the external file when a patch was staged from a stale read', async () => {
    const { fs, file, version, external, bytes } = await setup()
    const target = await file('a', 'old\n')
    fs.internals.inspectTemp = external('a')
    await expect(fs.patchText(target, hunks(), { version: await version(target) }))
      .rejects.toMatchObject({ code: 'FS_STALE_VERSION' })
    expect(await bytes('a')).toBe('external edit that is longer')
  })

  it('keeps a file that changed right before the delete', async () => {
    const { fs, file, version, external, bytes } = await setup()
    const target = await file('a', 'old\n')
    fs.internals.inspectBeforeMutation = external('a')
    await expect(fs.deleteFile(target, { version: await version(target) }))
      .rejects.toMatchObject({ code: 'FS_STALE_VERSION' })
    expect(await bytes('a')).toBe('external edit that is longer')
  })

  it('publishes nothing when the move source changed before the destination was written', async () => {
    const { fs, root, file, version, external, bytes } = await setup()
    const source = await file('a', 'old\n')
    const destination = await fs.resolve('b')
    fs.internals.inspectBeforeMutation = external('a')
    await expect(fs.moveFile(source, destination, { expectedSource: { version: await version(source) } }))
      .rejects.toMatchObject({ code: 'FS_STALE_VERSION' })
    expect(await bytes('a')).toBe('external edit that is longer')
    await expect(access(join(root, 'b'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('keeps a move source that changed after the destination was staged and reports it', async () => {
    const { fs, file, external, bytes } = await setup()
    const source = await file('a', 'old\n')
    const destination = await fs.resolve('b')
    let staged = 0
    fs.internals.inspectTemp = async (paths) => {
      staged += 1
      if (paths.tempPath.includes('b')) await external('a')()
    }
    const result = await fs.moveFile(source, destination, {})
    expect(staged).toBe(1)
    expect(result).toMatchObject({ sourceDeleted: false, sourceFailure: { code: 'FS_STALE_VERSION' } })
    expect(await bytes('a')).toBe('external edit that is longer')
    expect(await bytes('b')).toBe('old\n')
  })
})

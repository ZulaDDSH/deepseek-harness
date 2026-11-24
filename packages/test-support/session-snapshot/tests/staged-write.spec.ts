import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { publishStagedWrites } from '../src/staged-write.ts'

async function directory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'staged-write-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  return root
}

it('replaces every target once all outputs are staged', async () => {
  const root = await directory()
  await writeFile(join(root, 'a'), 'old a')
  await publishStagedWrites([{ path: join(root, 'a'), content: 'new a' }, { path: join(root, 'b'), content: 'new b' }])
  expect(await readFile(join(root, 'a'), 'utf8')).toBe('new a')
  expect(await readFile(join(root, 'b'), 'utf8')).toBe('new b')
  expect((await readdir(root)).sort()).toEqual(['a', 'b'])
})

it('leaves every selected file untouched when a later output cannot be written', async () => {
  const root = await directory()
  await writeFile(join(root, 'a'), 'old a')
  await expect(publishStagedWrites([
    { path: join(root, 'a'), content: 'new a' },
    { path: join(root, 'missing', 'child'), content: 'new child' },
  ])).rejects.toMatchObject({ code: 'ENOENT' })
  expect(await readFile(join(root, 'a'), 'utf8')).toBe('old a')
  expect(await readdir(root)).toEqual(['a'])
})

it('removes its staging files when a target parent is not a directory', async () => {
  const root = await directory()
  await writeFile(join(root, 'a'), 'old a')
  await writeFile(join(root, 'b-blocker'), 'x')
  await expect(publishStagedWrites([
    { path: join(root, 'a'), content: 'new a' },
    { path: join(root, 'b-blocker', 'nested'), content: 'never' },
  ])).rejects.toBeInstanceOf(Error)
  expect(await readFile(join(root, 'a'), 'utf8')).toBe('old a')
  expect((await readdir(root)).sort()).toEqual(['a', 'b-blocker'])
})

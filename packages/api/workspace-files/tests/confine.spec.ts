import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { failureOf, openWorkspace, signal, type Harness } from './harness.ts'

let harness: Harness

beforeEach(async () => {
  harness = await openWorkspace('dsh-workspace-files-confine-')
  await writeFile(join(harness.outside, 'secret.txt'), 'secret')
  await writeFile(join(harness.workspace, 'inside.txt'), 'inside')
})

afterEach(async () => {
  await harness.dispose()
})

const refused = { code: 'workspace-file/outside-workspace' }

describe('workspaceFiles confineReads', () => {
  it('reads and stats workspace files', async () => {
    const files = harness.endpoint({ confineReads: true })
    expect((await files.read(harness.scope, 'inside.txt', {}, signal())).text).toBe('inside')
    expect((await files.stat(harness.scope, join(harness.workspace, 'inside.txt'), signal())).bytes).toBe(6)
    expect(Buffer.from((await files.readBytes(harness.scope, 'inside.txt', {}, signal())).data).toString()).toBe('inside')
  })

  it('refuses an absolute path outside the workspace on every read method', async () => {
    const files = harness.endpoint({ confineReads: true })
    const path = join(harness.outside, 'secret.txt')
    expect(await failureOf(files.read(harness.scope, path, {}, signal()))).toMatchObject(refused)
    expect(await failureOf(files.readBytes(harness.scope, path, {}, signal()))).toMatchObject(refused)
    expect(await failureOf(files.stat(harness.scope, path, signal()))).toMatchObject(refused)
  })

  it('refuses parent traversal out of the workspace', async () => {
    const files = harness.endpoint({ confineReads: true })
    expect(await failureOf(files.read(harness.scope, '../outside/secret.txt', {}, signal()))).toMatchObject(refused)
  })

  it('refuses a file reached through a linked directory that leaves the workspace', async () => {
    await symlink(harness.outside, join(harness.workspace, 'escape'), process.platform === 'win32' ? 'junction' : 'dir')
    const files = harness.endpoint({ confineReads: true })
    expect(await failureOf(files.read(harness.scope, 'escape/secret.txt', {}, signal()))).toMatchObject(refused)
    expect(await failureOf(files.readBytes(harness.scope, 'escape/secret.txt', {}, signal()))).toMatchObject(refused)
  })

  it('refuses a baseFile hop whose relative target leaves the workspace', async () => {
    await mkdir(join(harness.workspace, 'sub'))
    await writeFile(join(harness.workspace, 'sub', 'base.txt'), 'base')
    const files = harness.endpoint({ confineReads: true })
    const failure = await failureOf(files.readBytes(harness.scope, '../../outside/secret.txt', { baseFile: 'sub/base.txt' }, signal()))
    expect(failure).toMatchObject(refused)
  })

  it('refuses a file watch outside the workspace', async () => {
    const files = harness.endpoint({ confineReads: true })
    const stream = files.changes(harness.scope, join(harness.outside, 'secret.txt'), signal())[Symbol.asyncIterator]()
    expect(await failureOf(stream.next())).toMatchObject(refused)
  })

  it('keeps reading outside files while the switch is off', async () => {
    const files = harness.endpoint()
    expect((await files.read(harness.scope, join(harness.outside, 'secret.txt'), {}, signal())).text).toBe('secret')
  })
})

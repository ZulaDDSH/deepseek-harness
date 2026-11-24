import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { WorkspaceFiles } from '../src/index.ts'
import { failureOf, openWorkspace, signal, viewer, type Harness } from './harness.ts'

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
    const files = harness.endpoint({}, viewer)
    expect((await files.read(harness.scope, 'inside.txt', {}, signal())).text).toBe('inside')
    expect((await files.stat(harness.scope, join(harness.workspace, 'inside.txt'), signal())).bytes).toBe(6)
    expect(Buffer.from((await files.readBytes(harness.scope, 'inside.txt', {}, signal())).data).toString()).toBe('inside')
  })

  it('refuses an absolute path outside the workspace on every read method', async () => {
    const files = harness.endpoint({}, viewer)
    const path = join(harness.outside, 'secret.txt')
    expect(await failureOf(files.read(harness.scope, path, {}, signal()))).toMatchObject(refused)
    expect(await failureOf(files.readBytes(harness.scope, path, {}, signal()))).toMatchObject(refused)
    expect(await failureOf(files.stat(harness.scope, path, signal()))).toMatchObject(refused)
  })

  it('refuses parent traversal out of the workspace', async () => {
    const files = harness.endpoint({}, viewer)
    expect(await failureOf(files.read(harness.scope, '../outside/secret.txt', {}, signal()))).toMatchObject(refused)
  })

  it('refuses a file reached through a linked directory that leaves the workspace', async () => {
    await symlink(harness.outside, join(harness.workspace, 'escape'), process.platform === 'win32' ? 'junction' : 'dir')
    const files = harness.endpoint({}, viewer)
    expect(await failureOf(files.read(harness.scope, 'escape/secret.txt', {}, signal()))).toMatchObject(refused)
    expect(await failureOf(files.readBytes(harness.scope, 'escape/secret.txt', {}, signal()))).toMatchObject(refused)
  })

  it('refuses a baseFile hop whose relative target leaves the workspace', async () => {
    await mkdir(join(harness.workspace, 'sub'))
    await writeFile(join(harness.workspace, 'sub', 'base.txt'), 'base')
    const files = harness.endpoint({}, viewer)
    const failure = await failureOf(files.readBytes(harness.scope, '../../outside/secret.txt', { baseFile: 'sub/base.txt' }, signal()))
    expect(failure).toMatchObject(refused)
  })

  it('refuses a file watch outside the workspace', async () => {
    const files = harness.endpoint({}, viewer)
    const stream = files.changes(harness.scope, join(harness.outside, 'secret.txt'), signal())[Symbol.asyncIterator]()
    expect(await failureOf(stream.next())).toMatchObject(refused)
  })

  it('confines reads under the schema defaults', async () => {
    const { confineReads, readRoots } = new WorkspaceFiles.Config({} as never)
    expect(confineReads).toBe(true)
    expect(readRoots).toEqual([])
    const files = harness.endpoint({ confineReads, readRoots }, viewer)
    expect(await failureOf(files.read(harness.scope, join(harness.outside, 'secret.txt'), {}, signal()))).toMatchObject(refused)
  })

  it('admits only files under a configured read root', async () => {
    await mkdir(join(harness.outside, 'shared'))
    await writeFile(join(harness.outside, 'shared', 'note.txt'), 'shared')
    const files = harness.endpoint({ readRoots: [join(harness.outside, 'shared')] }, viewer)
    expect((await files.read(harness.scope, join(harness.outside, 'shared', 'note.txt'), {}, signal())).text).toBe('shared')
    expect((await files.stat(harness.scope, join(harness.outside, 'shared', 'note.txt'), signal())).bytes).toBe(6)
    expect(await failureOf(files.read(harness.scope, join(harness.outside, 'secret.txt'), {}, signal()))).toMatchObject(refused)
    expect(await failureOf(files.read(harness.scope, join(harness.outside, 'shared', '..', 'secret.txt'), {}, signal()))).toMatchObject(refused)
  })

  it('lets a Host-built trusted scope stat an outside file', async () => {
    const files = harness.endpoint({}, viewer)
    const path = join(harness.outside, 'secret.txt')
    expect((await files.stat({ ...harness.scope, trusted: true }, path, signal())).bytes).toBe(6)
    expect(await failureOf(files.stat(harness.scope, path, signal()))).toMatchObject(refused)
  })

  it('keeps an owner reading and statting outside files under the default config', async () => {
    const files = harness.endpoint({}, { kind: 'owner' })
    const path = join(harness.outside, 'secret.txt')
    expect((await files.read(harness.scope, path, {}, signal())).text).toBe('secret')
    expect((await files.stat(harness.scope, path, signal())).bytes).toBe(6)
    expect(Buffer.from((await files.readBytes(harness.scope, path, {}, signal())).data).toString()).toBe('secret')
  })

  it('keeps in-process code outside a Remote call reading outside files under the default config', async () => {
    const files = harness.endpoint()
    expect((await files.read(harness.scope, join(harness.outside, 'secret.txt'), {}, signal())).text).toBe('secret')
  })

  it('keeps a scoped principal reading outside files while the switch is off', async () => {
    const files = harness.endpoint({ confineReads: false }, viewer)
    expect((await files.read(harness.scope, join(harness.outside, 'secret.txt'), {}, signal())).text).toBe('secret')
  })
})

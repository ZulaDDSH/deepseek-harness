/** Linux association parsing over isolated installed-entry fixtures and an injected OS command runner. */
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, expect, it, onTestFinished, vi } from 'vitest'
import { desktopApplicationIcon } from '../src/desktop-entry.ts'
import { nativeFileApplications, openNativeFileApplication } from '../src/file-applications.ts'
import type { NativeCommandRunner } from '../src/runner.ts'

const probe = vi.hoisted(() => ({
  reads: [] as string[],
  readdirs: 0,
  failRead: undefined as ((path: string) => unknown) | undefined,
  onReaddir: undefined as (() => void) | undefined,
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    readFile: ((path: string, ...rest: unknown[]) => {
      probe.reads.push(String(path))
      const failure = probe.failRead?.(String(path))
      if (failure !== undefined) return Promise.reject(failure)
      return (actual.readFile as (...args: unknown[]) => Promise<unknown>)(path, ...rest)
    }) as typeof actual.readFile,
    readdir: ((...args: unknown[]) => {
      probe.readdirs += 1
      probe.onReaddir?.()
      return (actual.readdir as (...a: unknown[]) => Promise<unknown>)(...args)
    }) as typeof actual.readdir,
  }
})

beforeEach(() => {
  probe.reads = []
  probe.readdirs = 0
  probe.failRead = undefined
  probe.onReaddir = undefined
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-file-apps-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'applications', 'nested'), { recursive: true })
  await mkdir(join(root, 'pixmaps'))
  await writeFile(join(root, 'applications', 'player.desktop'), '[Desktop Entry]\nName=Player\nName[zh_CN]=播放器\nIcon=player\nExec=player %f\n[Desktop Action Extra]\nName=Wrong\n')
  await writeFile(join(root, 'applications', 'nested', 'other.desktop'), '[Desktop Entry]\nName=Other\nExec=other %f\n')
  await writeFile(join(root, 'pixmaps', 'player.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
  const run = vi.fn<NativeCommandRunner>(async (command, args) => ({
    stdout: command === 'gio' && args[0] === 'info' ? '  standard::content-type: audio/mpeg\n'
      : command === 'env' ? 'Default application for audio/mpeg: player.desktop\nRegistered applications:\n  player.desktop\n  nested-other.desktop\n  missing.desktop\nRecommended applications:\n  player.desktop\n' : '', stderr: '',
  }))
  return { root, run, facts: { platform: 'linux' as const, osRelease: 'linux', env: { XDG_DATA_HOME: root, XDG_DATA_DIRS: '', LANG: 'zh_CN.UTF-8' }, run } }
}

it('deduplicates GIO handlers, resolves nested ids, localizes names, and reuses desktop artwork', async () => {
  const { root, facts, run } = await fixture()
  const signal = new AbortController().signal
  const apps = await nativeFileApplications('/file.mp3', signal, facts)
  expect(apps).toEqual([
    { id: join(root, 'applications', 'player.desktop'), name: '播放器', default: true, icon: expect.stringMatching(/^data:image\/svg\+xml;base64,/) as string },
    { id: join(root, 'applications', 'nested', 'other.desktop'), name: 'Other', default: false, icon: null },
  ])
  await openNativeFileApplication('/file.mp3', apps[0]!.id, signal, facts)
  expect(run).toHaveBeenLastCalledWith('gio', ['launch', apps[0]!.id, '/file.mp3'], signal, 'hidden')
  await expect(openNativeFileApplication('/file.mp3', '/unregistered.desktop', signal, facts)).rejects.toThrow('not registered')
})

it('keeps nondefault applications when the desktop has no default and omits hidden or unnamed entries', async () => {
  const { root, facts, run } = await fixture()
  await writeFile(join(root, 'applications', 'player.desktop'), '[Desktop Entry]\nHidden=true\nName=Hidden\n')
  await writeFile(join(root, 'applications', 'unnamed.desktop'), '[Desktop Entry]\nExec=unnamed\n')
  run.mockImplementation(async command => ({ stdout: command === 'gio' ? 'standard::content-type: audio/mpeg' : 'Registered applications:\n  player.desktop\n  unnamed.desktop\n  nested-other.desktop\n', stderr: '' }))
  expect(await nativeFileApplications('/file.mp3', new AbortController().signal, facts)).toEqual([
    { id: join(root, 'applications', 'nested', 'other.desktop'), name: 'Other', default: false, icon: null },
  ])
})

it('rejects missing content-type metadata instead of fabricating associations', async () => {
  const { facts, run } = await fixture()
  run.mockResolvedValue({ stdout: 'no content type', stderr: '' })
  await expect(nativeFileApplications('/file.mp3', new AbortController().signal, facts)).rejects.toThrow('content type')
})


it('tolerates absent desktop roots and directory-shaped icon paths without a locale override', async () => {
  const { root, facts } = await fixture()
  const icon = join(root, 'folder.png')
  await mkdir(icon)
  expect(await desktopApplicationIcon(icon, [])).toBeNull()
  const apps = await nativeFileApplications('/file.mp3', new AbortController().signal, {
    ...facts, env: { XDG_DATA_HOME: root, XDG_DATA_DIRS: join(root, 'absent') },
  })
  expect(apps[0]?.name).toBe('Player')
})

it('skips an unreadable or removed desktop entry and still lists and launches the valid handlers', async () => {
  const { root, facts, run } = await fixture()
  const stale = join(root, 'applications', 'player.desktop')
  probe.failRead = path => path === stale ? Object.assign(new Error('EACCES'), { code: 'EACCES' }) : undefined
  const signal = new AbortController().signal
  const other = join(root, 'applications', 'nested', 'other.desktop')
  expect(await nativeFileApplications('/file.mp3', signal, facts)).toEqual([
    { id: other, name: 'Other', default: false, icon: null },
  ])
  await openNativeFileApplication('/file.mp3', other, signal, facts)
  expect(run).toHaveBeenLastCalledWith('gio', ['launch', other, '/file.mp3'], signal, 'hidden')
})

it('keeps cancellation distinct from an unreadable desktop entry', async () => {
  const { root, facts } = await fixture()
  const controller = new AbortController()
  probe.failRead = (path) => {
    if (path !== join(root, 'applications', 'player.desktop')) return undefined
    controller.abort('caller cancelled')
    return Object.assign(new Error('aborted'), { code: 'ABORT_ERR' })
  }
  await expect(nativeFileApplications('/file.mp3', controller.signal, facts)).rejects.toBe('caller cancelled')
})

it('walks the desktop tree once per discovery however many ids GIO reports', async () => {
  const { facts, run } = await fixture()
  const missing = Array.from({ length: 50 }, (_, index) => `  missing-${index}.desktop`).join('\n')
  run.mockImplementation(async command => ({
    stdout: command === 'gio' ? 'standard::content-type: audio/mpeg' : `Registered applications:\n  player.desktop
${missing}
  nested-other.desktop
`, stderr: '',
  }))
  const apps = await nativeFileApplications('/file.mp3', new AbortController().signal, facts)
  expect(apps.map(app => app.name)).toEqual(['播放器', 'Other'])
  expect(probe.readdirs).toBe(2)
})

it('stops the desktop tree walk when the caller cancels during traversal', async () => {
  const { facts } = await fixture()
  const controller = new AbortController()
  probe.onReaddir = () => { controller.abort('caller cancelled') }
  await expect(nativeFileApplications('/file.mp3', controller.signal, facts)).rejects.toBe('caller cancelled')
  expect(probe.readdirs).toBe(1)
})

it('returns no artwork for an oversized icon but keeps the application', async () => {
  const { root, facts } = await fixture()
  const big = join(root, 'big.svg')
  await writeFile(big, Buffer.alloc(1024 * 1024 + 1, 0x20))
  await writeFile(join(root, 'applications', 'player.desktop'), `[Desktop Entry]\nName=Player\nIcon=${big}\n`)
  const apps = await nativeFileApplications('/file.mp3', new AbortController().signal, facts)
  expect(apps[0]).toMatchObject({ name: 'Player', icon: null })
  expect(await desktopApplicationIcon(join(root, 'pixmaps', 'player.svg'), [], { maxBytes: 4 })).toBeNull()
  expect((await desktopApplicationIcon(join(root, 'pixmaps', 'player.svg'), []))?.contentType).toBe('image/svg+xml')
})

it('spends an aggregate icon budget across applications', async () => {
  const { root, facts, run } = await fixture()
  const art = join(root, 'art.svg')
  await writeFile(art, Buffer.alloc(1_000_000, 0x20))
  const names = Array.from({ length: 9 }, (_, index) => `budget-${index}.desktop`)
  for (const name of names) await writeFile(join(root, 'applications', name), `[Desktop Entry]\nName=${name}\nIcon=${art}\n`)
  run.mockImplementation(async command => ({
    stdout: command === 'gio' ? 'standard::content-type: audio/mpeg' : `Registered applications:\n${names.map(name => `  ${name}`).join('\n')}
`, stderr: '',
  }))
  const apps = await nativeFileApplications('/file.mp3', new AbortController().signal, facts)
  expect(apps.map(app => app.icon === null)).toEqual([false, false, false, false, false, false, false, false, true])
})

it('does not read artwork when only validating a launch, and honors cancellation while reading it', async () => {
  const { root, facts } = await fixture()
  const signal = new AbortController().signal
  const apps = await nativeFileApplications('/file.mp3', signal, facts)
  expect(probe.reads.some(path => path.endsWith('.svg'))).toBe(true)
  probe.reads = []
  await openNativeFileApplication('/file.mp3', apps[0]!.id, signal, facts)
  expect(probe.reads.some(path => path.endsWith('.svg'))).toBe(false)
  const cancelled = new AbortController()
  cancelled.abort('caller cancelled')
  await expect(desktopApplicationIcon(join(root, 'pixmaps', 'player.svg'), [], { signal: cancelled.signal })).rejects.toBe('caller cancelled')
})

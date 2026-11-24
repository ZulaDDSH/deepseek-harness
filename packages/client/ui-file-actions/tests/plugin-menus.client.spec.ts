// @vitest-environment jsdom
/** File-operation contributions survive removal of application-opening providers. */
import type { SessionId } from '@deepseek-ai/dsh-session'
import { afterEach, expect, it, onTestFinished, vi } from 'vitest'
import { MenuRegistry } from '@deepseek-ai/dsh-client-ui-context-menu/src/client/registry.ts'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { apply } from '../src/client/index.ts'
import type { FileActionSource } from '../src/types.ts'
import { brandString } from '@deepseek-ai/dsh-brand'

afterEach(() => { vi.unstubAllGlobals() })

it('contributes file and image operations without open-in-app and withdraws them on unload', async () => {
  const runtime = await SlotTestRuntime.create()
  onTestFinished(() => runtime.dispose())
  const { ctx } = runtime
  await runtime.declare({
    'contextMenu.icon': { kind: 'keyed', scope: 'root', inline: true },
  })
  const failure = vi.fn(), notify = vi.fn()
  const registry = new MenuRegistry(failure)
  ctx.provide('contextMenus', { register: registry.register.bind(registry), notify } as never)
  const registerLocale = vi.fn(() => () => {})
  ctx.provide('locale', { register: registerLocale, bind: () => (key: string) => key } as never)
  const readBytes = vi.fn(async () => ({ ok: true as const, value: { absolutePath: '/workspace/report.txt', version: 'v1', offset: 0, data: [1, 2, 3], eof: true } }))
  const workspaceFiles = {
    stat: async () => ({ ok: true, value: { absolutePath: '/workspace/image.png' } }),
    readBytes,
  }
  const session = { openWorkspacePath: vi.fn() }
  runtime.remote.provideNamespaces({ workspaceFiles, session })
  const fiber = ctx.plugin({ apply })
  await fiber.await()
  try {
    await vi.waitFor(() => { expect(registerLocale).toHaveBeenCalledOnce() })
    expect(ctx.slots.entries('contextMenu.icon').map(entry => entry.options.key)).toEqual([
      'file-actions.copy', 'file-actions.download', 'file-actions.save',
    ])
    const file = registry.resolve({ kind: 'file', value: { sessionId: brandString<SessionId>('files'), path: 'image.png' } })
    await file.ready
    expect(file.source.getSnapshot().map(action => action.id)).toEqual([
      'file-actions.file/copyImage', 'file-actions.file/download',
    ])
    expect(file.source.getSnapshot().find(action => action.id.endsWith('/download'))?.disabled).toBe(false)
    const save = vi.spyOn(ctx.fileActions, 'save').mockImplementation(async (source: FileActionSource) => {
      await source.read!(new AbortController().signal)
      return { status: 'requested' }
    })
    const downloading = registry.resolve({ kind: 'file', value: { sessionId: brandString<SessionId>('files'), path: 'report.txt' } })
    await downloading.ready
    expect(downloading.source.getSnapshot().map(action => action.id)).toEqual(['file-actions.file/download'])
    downloading.select('file-actions.file/download')
    await vi.waitFor(() => { expect(notify).toHaveBeenCalledWith('menu.downloadStarted', true, undefined) })
    expect(save).toHaveBeenCalledOnce()
    expect(readBytes).toHaveBeenCalledWith(brandString<SessionId>('files'), 'report.txt', { range: { offset: 0 } }, expect.any(AbortSignal))
    save.mockRestore()
    const image = registry.resolve({ kind: 'image', value: { url: 'https://example.com/image.png' } })
    await image.ready
    expect(image.source.getSnapshot().map(action => action.id)).toEqual([
      'file-actions.image/copy', 'file-actions.image/download',
    ])
    await fiber.dispose()
    expect(ctx.slots.entries('contextMenu.icon')).toEqual([])
    expect(file.source.getSnapshot()).toEqual([])
    expect(image.source.getSnapshot()).toEqual([])
    file.dispose()
    image.dispose()
    expect(failure).not.toHaveBeenCalled()
  } finally {
    registry.dispose()
    await runtime.dispose()
  }
})

it('saves an original above the complete-read cap through bounded windows and disables oversized originals', async () => {
  const runtime = await SlotTestRuntime.create()
  onTestFinished(() => runtime.dispose())
  const { ctx } = runtime
  await runtime.declare({
    'contextMenu.icon': { kind: 'keyed', scope: 'root', inline: true },
  })
  const registry = new MenuRegistry(vi.fn())
  ctx.provide('contextMenus', { register: registry.register.bind(registry), notify: vi.fn() } as never)
  const registerLocale = vi.fn(() => () => {})
  ctx.provide('locale', { register: registerLocale, bind: () => (key: string) => key } as never)
  const size = 5 * 1024 * 1024, window = 2 * 1024 * 1024
  const bytes = Uint8Array.from({ length: size }, (_, index) => index % 251)
  const readBytes = vi.fn(async (_sessionId: unknown, _path: string, options: { range?: { offset?: number } }) => {
    if (options.range === undefined) return { ok: false as const }
    const offset = options.range.offset ?? 0
    const end = Math.min(size, offset + window)
    return { ok: true as const, value: { absolutePath: '/workspace/big.bin', version: 'v1', offset, data: bytes.slice(offset, end), eof: end >= size } }
  })
  const stat = vi.fn(async (_sessionId: unknown, path: string) => ({ ok: true as const, value: {
    absolutePath: `/workspace/${path}`, version: 'v1', bytes: path === 'huge.bin' ? 300 * 1024 * 1024 : size,
  } }))
  runtime.remote.provideNamespaces({ workspaceFiles: { stat, readBytes }, session: { openWorkspacePath: vi.fn() } })
  const fiber = ctx.plugin({ apply })
  await fiber.await()
  let saved: Blob | undefined
  const save = vi.spyOn(ctx.fileActions, 'save').mockImplementation(async (source: FileActionSource) => {
    saved = await source.read!(new AbortController().signal)
    return { status: 'requested' }
  })
  try {
    await vi.waitFor(() => { expect(registerLocale).toHaveBeenCalledOnce() })
    const sessionId = brandString<SessionId>('files')
    const big = registry.resolve({ kind: 'file', value: { sessionId, path: 'big.bin' } })
    await big.ready
    big.select('file-actions.file/download')
    await vi.waitFor(() => { expect(saved).toBeDefined() })
    expect(saved!.size).toBe(size)
    expect(readBytes).toHaveBeenCalledTimes(3)
    const huge = registry.resolve({ kind: 'file', value: { sessionId, path: 'huge.bin' } })
    await huge.ready
    expect(huge.source.getSnapshot().length).toBeGreaterThan(0)
    expect(huge.source.getSnapshot().every(action => action.disabled === true)).toBe(true)
    huge.dispose()
    big.dispose()
  } finally {
    save.mockRestore()
    await fiber.dispose()
    registry.dispose()
    await runtime.dispose()
  }
})

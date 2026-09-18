import { EventEmitter } from 'node:events'
import type { BrowserWindow } from 'electron'
import { afterEach, expect, it, vi } from 'vitest'
import { parseDesktopAttentionRequest } from '../src/ipc.ts'
import { resolveDesktopLocale } from '../src/locale.ts'
import { DesktopSessionAttention } from '../src/session-attention.ts'

const native = await vi.hoisted(async () => {
  const { EventEmitter } = await import('node:events')
  const notices: Notice[] = []
  class Notice extends EventEmitter {
    static isSupported = vi.fn(() => true)
    show = vi.fn()
    close = vi.fn()
    constructor(readonly options: unknown) { super(); notices.push(this) }
  }
  return { notices, Notice }
})
vi.mock('electron', () => ({ Notification: native.Notice }))

let attention: DesktopSessionAttention | undefined
afterEach(() => {
  attention?.dispose()
  attention = undefined
  native.notices.length = 0
  vi.clearAllMocks()
  native.Notice.isSupported.mockReturnValue(true)
})

function bench() {
  const window = Object.assign(new EventEmitter(), {
    destroyed: false,
    minimized: false,
    isDestroyed() { return this.destroyed },
    isMinimized() { return this.minimized },
    restore: vi.fn(function (this: { minimized: boolean }) { this.minimized = false }),
    show: vi.fn(),
    focus: vi.fn(),
  })
  const activated = vi.fn()
  attention = new DesktopSessionAttention(
    resolveDesktopLocale('en-US'),
    () => window as unknown as BrowserWindow,
    activated,
  )
  return { window, activated }
}

it.each([
  ['approval', 'Approval requested'],
  ['plan-review', 'Plan ready for review'],
  ['question', 'Answer requested'],
  ['completed', 'Session completed'],
  ['failed', 'Session failed'],
] as const)('presents localized %s attention and activates the Session on click', (kind, body) => {
  const b = bench()
  b.window.minimized = true
  attention!.notify({ sessionId: 's1', title: 'Background task', kind })
  expect(native.notices).toHaveLength(1)
  expect(native.notices[0]!.options).toEqual({ title: 'Background task', body, silent: true })
  native.notices[0]!.emit('click')
  expect(b.window.restore).toHaveBeenCalledOnce()
  expect(b.window.show).toHaveBeenCalledOnce()
  expect(b.window.focus).toHaveBeenCalledOnce()
  expect(b.activated).toHaveBeenCalledExactlyOnceWith('s1')
})

it('replaces stale notification ownership for the same Session', () => {
  const b = bench()
  attention!.notify({ sessionId: 's1', title: 'Task', kind: 'question' })
  const first = native.notices[0]!
  attention!.notify({ sessionId: 's1', title: 'Task', kind: 'failed' })
  expect(first.close).toHaveBeenCalledOnce()
  first.emit('click')
  expect(b.activated).not.toHaveBeenCalled()
  native.notices[1]!.emit('click')
  expect(b.activated).toHaveBeenCalledExactlyOnceWith('s1')
})

it('does nothing when native notifications are unavailable', () => {
  bench()
  native.Notice.isSupported.mockReturnValue(false)
  attention!.notify({ sessionId: 's1', title: 'Task', kind: 'completed' })
  expect(native.notices).toHaveLength(0)
})

it.each([
  null,
  {},
  { sessionId: '', title: 'x', kind: 'question' },
  { sessionId: 's1', title: 'x'.repeat(257), kind: 'question' },
  { sessionId: 's1', title: 'x', kind: 'other' },
])('rejects invalid product-renderer attention payloads', (value) => {
  expect(() => parseDesktopAttentionRequest(value)).toThrow('invalid attention request')
})

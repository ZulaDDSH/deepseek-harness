import { EventEmitter } from 'node:events'
import { expect, it, vi } from 'vitest'
import type { BrowserWindow, WebContents } from 'electron'

const openExternal = vi.hoisted(() => vi.fn())
vi.mock('electron', () => ({ shell: { openExternal } }))

import { applyBrowserGuestPolicy, applyWindowNavigationPolicy } from '../src/browser-guest-policy.ts'

it('installs one popup policy for every attached guest without accumulating host listeners', () => {
  const host = Object.assign(new EventEmitter(), {
    setWindowOpenHandler: vi.fn(),
    getURL: () => 'dsh-app://app/',
  })
  const window = { webContents: host } as unknown as BrowserWindow

  applyWindowNavigationPolicy(window)

  expect(host.listenerCount('did-attach-webview')).toBe(1)
  const firstHandler = vi.fn()
  const secondHandler = vi.fn()
  const firstGuest = Object.assign(new EventEmitter(), { setWindowOpenHandler: firstHandler }) as unknown as WebContents
  const secondGuest = Object.assign(new EventEmitter(), { setWindowOpenHandler: secondHandler }) as unknown as WebContents
  host.emit('did-attach-webview', {}, firstGuest)
  host.emit('did-attach-webview', {}, secondGuest)

  expect(firstHandler).toHaveBeenCalledOnce()
  expect(secondHandler).toHaveBeenCalledOnce()
  expect(host.listenerCount('did-attach-webview')).toBe(1)
})

it('rejects non-http guest sources and strips guest privileges for http sources', () => {
  const preferences = { preload: 'guest-preload', nodeIntegration: true, contextIsolation: false, sandbox: false }
  expect(applyBrowserGuestPolicy(preferences, 'file:///secret')).toBe(false)
  expect(preferences).toEqual({ preload: 'guest-preload', nodeIntegration: true, contextIsolation: false, sandbox: false })

  expect(applyBrowserGuestPolicy(preferences, 'https://example.com/')).toBe(true)
  expect(preferences).toMatchObject({ nodeIntegration: false, contextIsolation: true, sandbox: true })
  expect(preferences).not.toHaveProperty('preload')
})

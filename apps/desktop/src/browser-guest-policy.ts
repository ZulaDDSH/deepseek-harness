/** Application-window navigation policy and in-app Browser guest policy. */
import { shell, type BrowserWindow } from 'electron'
import { SCHEME } from './ipc.ts'

const OPENABLE_PROTOCOLS = ['http:', 'https:']

/** Whether an address is one this application hands to the system browser. */
function isOpenable(url: string): boolean {
  try {
    return OPENABLE_PROTOCOLS.includes(new URL(url).protocol)
  } catch {
    // A guest can request a window for an address Electron cannot parse.
    return false
  }
}

/**
 * Restrict one window to its own origin and hand its other Web addresses to the system browser.
 * @param window - Window whose contents are restricted.
 */
export function applyWindowNavigationPolicy(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isOpenable(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('did-attach-webview', (_event, guest) => {
    guest.setWindowOpenHandler(({ url }) => {
      if (isOpenable(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })
  })
  window.webContents.on('will-navigate', (event, url) => {
    const destination = new URL(url)
    const current = new URL(window.webContents.getURL())
    if (destination.protocol !== `${SCHEME}:`
      && !(destination.protocol === 'http:' && destination.origin === current.origin)) {
      event.preventDefault()
      if (isOpenable(url)) void shell.openExternal(url)
    }
  })
  window.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    if (!applyBrowserGuestPolicy(webPreferences, params.src)) event.preventDefault()
  })
}

/**
 * Apply the guest restrictions Electron uses for an attaching in-app Browser WebView.
 * @param attach - The embedding window's contents, whose attach event carries each guest.
 * @param webPreferences - Preferences Electron is about to apply to the attaching guest.
 * @param src - Address the guest is attaching with.
 * @returns Whether the guest may attach.
 */
export function applyBrowserGuestPolicy(
  webPreferences: Electron.WebPreferences,
  src: unknown,
): boolean {
  if (typeof src !== 'string' || !isOpenable(src)) return false
  delete webPreferences.preload
  webPreferences.nodeIntegration = false
  webPreferences.contextIsolation = true
  webPreferences.sandbox = true
  return true
}

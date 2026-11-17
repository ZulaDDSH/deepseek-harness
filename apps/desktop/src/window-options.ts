/** Application-window construction options, including per-platform frame treatment. */
import { nativeTheme, type BrowserWindowConstructorOptions } from 'electron'
import { WINDOWS_TITLEBAR_HEIGHT } from './windows-layout.ts'

/**
 * Build the constructor options for one application window.
 * @param preload - Absolute path of the window's preload script.
 * @param show - Whether the window is visible as soon as it is created.
 * @param primary - Whether this is the primary window, which owns the Windows title bar.
 * @returns Options accepted by the `BrowserWindow` constructor.
 */
export function desktopWindowOptions(
  preload: string,
  show: boolean,
  primary: boolean,
): BrowserWindowConstructorOptions {
  return {
    width: 1280,
    height: 840,
    minWidth: 880,
    minHeight: 600,
    show,
    // A frame must have one background before the first paint: without it a
    // window shown before the document finishes paints blank, and every
    // recovery re-navigation flashes that blank again.
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1b1b1c' : '#f9fafb',
    ...(process.platform === 'win32' && primary ? {
      titleBarStyle: 'hidden' as const,
      titleBarOverlay: { height: WINDOWS_TITLEBAR_HEIGHT, color: nativeTheme.shouldUseDarkColors ? '#1b1b1c' : '#f9fafb',
        symbolColor: nativeTheme.shouldUseDarkColors ? '#f9fafb' : '#0f1115' },
    } : {}),
    // hiddenInset places traffic lights inside the sidebar; sidebar vibrancy
    // needs a transparent window background to show through the page.
    ...(process.platform === 'darwin' ? {
      titleBarStyle: 'hiddenInset' as const,
      trafficLightPosition: { x: 16, y: 18 },
      vibrancy: 'sidebar' as const,
      // 'active' keeps the vibrancy material stable when the window blurs;
      // 'followWindow' washes the sidebar out behind an unfocused window.
      visualEffectState: 'active' as const,
      backgroundColor: '#00000000',
    } : {}),
    webPreferences: {
      preload,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      // The in-app Browser tab uses an isolated Chromium guest on desktop.
      // Web fallback remains an iframe for non-Electron surfaces.
      webviewTag: true,
    },
  }
}

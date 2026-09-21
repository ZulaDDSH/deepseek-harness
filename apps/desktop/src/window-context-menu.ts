/** Application-window context menu: native edit roles and a copy action for selected text. */
import { Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import { resolveDesktopLocale } from './locale.ts'

/**
 * Register the context menu for one application window.
 * @param window - Window whose contents receive the menu.
 * @param language - Windows display language, or undefined to use the application locale.
 */
export function installWindowContextMenu(window: BrowserWindow, language: () => string): void {
  window.webContents.on('context-menu', (_event, state) => {
    const { isEditable, selectionText, editFlags } = state
    const items: MenuItemConstructorOptions[] = []
    if (isEditable) {
      items.push(
        { role: 'undo', enabled: editFlags.canUndo },
        { role: 'redo', enabled: editFlags.canRedo },
        { type: 'separator' },
        { role: 'cut', enabled: editFlags.canCut },
        { role: 'copy', enabled: editFlags.canCopy },
        { role: 'paste', enabled: editFlags.canPaste },
        { type: 'separator' },
        { role: 'selectAll', enabled: editFlags.canSelectAll },
      )
    } else if (selectionText.length > 0) {
      items.push({ role: 'copy', enabled: editFlags.canCopy })
    }
    // Empty accelerators suppress Electron's default shortcut labels for native roles.
    if (items.length > 0) {
      const messages = resolveDesktopLocale(language()).messages
      Menu.buildFromTemplate(items.map(item => ({
        ...item,
        ...(process.platform === 'win32' && item.role !== undefined && item.role in messages
          ? { label: messages[item.role as keyof typeof messages] } : {}),
        accelerator: '',
      }))).popup({ window })
    }
  })
}

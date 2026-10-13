/**
 * Settings shell contract — the types of the `sidebar.settings` occupant this
 * package renders. They live here rather than in ui-settings because they
 * reference the sidebar's own slot type: ui-settings is the settings domain's
 * base layer and must not depend on any `ui-*` presentation package, or the
 * reference graph closes a cycle through ui-sidebar → ui-layout → ui-theme.
 * The settings SLOT types (what registrants contribute) stay in ui-settings.
 */
import type { ConnectionState } from '@deepseek-ai/dsh-client-connection/client'
import type {
  HostObservable, InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls ui-sidebar's SlotMap merge (the 'sidebar.settings' entry)
// into every program that sees this contract.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
// Type-only: pulls the settings slot declarations the shell renders into.
import type { SettingsDirectoryItem, SettingsSaveStatus } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { PropsStore } from '@deepseek-ai/dsh-client-store'
import type { createSettingsShellStore } from './shell-store.ts'
import type { ShortcutCatalogEntry } from '@deepseek-ai/dsh-client-shortcuts/client'
import type { DesktopUpdateView } from '../types.ts'

/** One nav row projected from a settings.section registration's options. */
export interface SettingsSectionRow {
  id: string
  order: number
  label: string
}

/** Opaque tick that changes whenever the directory, the locale or the General rows change. */
export type SettingsSearchTick = object

/**
 * Registrant-private injected share of the settings shell (assembled in
 * apply): connection state and ledger projections arrive as hook-compartment
 * sources, while the reconnect command remains a plain callback.
 */
export type SettingsRootInjected = {
  /** Request the current shell-owned update action. */
  openDesktopUpdate: () => void
  /** Request a fresh logical generation and physical WebSocket immediately. */
  reconnect: () => void
  /** Find settings across every page; blank text finds nothing. */
  search: (query: string) => readonly SettingsDirectoryItem[]
  hooks: {
    /** Re-renders the search results when the directory or locale moves. */
    searchTick: HostObservable<SettingsSearchTick>
    /** Outcome of the latest Host settings writes. */
    saveStatus: HostObservable<SettingsSaveStatus>
    /** Effective command presentation, shared with the reference. */
    shortcuts: HostObservable<readonly ShortcutCatalogEntry[]>
    /** Shared Electron status for both sidebar locations. */
    desktopUpdate: HostObservable<DesktopUpdateView>
    /** Connection-owned state for the current Host connection. */
    connectionState: HostObservable<ConnectionState | undefined>
    /** settings.section ledger projected into ordered nav rows. */
    sections: HostObservable<readonly SettingsSectionRow[]>
  }
}

/**
 * Full component props of the settings shell root: the sidebar owner share
 * (wide/rail state) plus the declared render shares and the injected face
 * (hooks compartment bound to useSections). The declared store shares modal
 * visibility and section selection with application commands.
 */
export type SettingsRootComponentProps =
  PropsRuntime<'sidebar.settings'>
  & PropsRenderSlots<
    | 'settings.launcher'
    | 'settings.trigger'
    | 'settings.header'
    | 'settings.action'
    | 'settings.close'
    | 'settings.section'
  >
  & InjectFace<SettingsRootInjected>
  & PropsLocale<'settings'>
  & PropsStore<ReturnType<typeof createSettingsShellStore>>

/**
 * Workspace appearance vocabulary: the color and icon a Workspace carries, and
 * the shared maps every reader of that choice resolves through. Colors are
 * literal hex because a swatch must show the color a row will paint, not a
 * themed alias that resolves differently per surface; rows paint the choice
 * onto the folder glyph, and the label inherits the same color.
 */

/** The five choice colors, in menu order. */
export const WORKSPACE_COLORS = ['red', 'orange', 'green', 'blue', 'purple'] as const

/** The eight choice icons, in menu order. */
export const WORKSPACE_ICONS = [
  'folder', 'code', 'terminal', 'branch', 'rocket', 'spark', 'experiment', 'database',
] as const

/** One Workspace color choice. */
export type WorkspaceColor = typeof WORKSPACE_COLORS[number]

/** One Workspace icon choice. */
export type WorkspaceIcon = typeof WORKSPACE_ICONS[number]

/** A Workspace's chosen appearance; either half absent means the default look. */
/**
 * A Workspace's chosen appearance. Each half is explicitly | undefined so an editor can clear
 * that half through the same merge used to set it; undefined means the default look.
 */
export interface WorkspaceAppearance {
  color?: WorkspaceColor | undefined
  icon?: WorkspaceIcon | undefined
}

/** Swatch and row color per choice. */
export const WORKSPACE_APPEARANCE_COLORS: Readonly<Record<WorkspaceColor, string>> = {
  red: '#F04438',
  orange: '#F79009',
  green: '#12B76A',
  blue: '#2E90FA',
  purple: '#7A5AF8',
}

/**
 * Whether a stored value is one of the vocabulary's colors.
 * @param value - the decoded value to test.
 * @returns true when the value is a known color.
 */
export function isWorkspaceColor(value: unknown): value is WorkspaceColor {
  return typeof value === 'string' && (WORKSPACE_COLORS as readonly string[]).includes(value)
}

/**
 * Whether a stored value is one of the vocabulary's icons.
 * @param value - the decoded value to test.
 * @returns true when the value is a known icon.
 */
export function isWorkspaceIcon(value: unknown): value is WorkspaceIcon {
  return typeof value === 'string' && (WORKSPACE_ICONS as readonly string[]).includes(value)
}

/** The three appearance maps, keyed by Workspace, Chat Section, or Session identity. */
export type AppearanceMaps = {
  workspaces: Record<string, WorkspaceAppearance>
  sections: Record<string, WorkspaceAppearance>
  sessions: Record<string, WorkspaceAppearance>
}

/** One of the appearance maps. */
export type AppearanceKind = keyof AppearanceMaps

/** Browser-local storage key of the current appearance maps. */
export const APPEARANCE_STORAGE_KEY = 'dsh.workspace.appearance.v2'
const LEGACY_APPEARANCE_STORAGE_KEY = 'dsh.workspace.appearance.v1'

function readAppearanceMap(value: unknown): Record<string, WorkspaceAppearance> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).flatMap(([id, appearance]) => {
    if (appearance === null || typeof appearance !== 'object' || Array.isArray(appearance)) return []
    const { color, icon } = appearance as Record<string, unknown>
    return isWorkspaceColor(color) || isWorkspaceIcon(icon)
      ? [[id, {
        ...(isWorkspaceColor(color) ? { color } : {}),
        ...(isWorkspaceIcon(icon) ? { icon } : {}),
      }]]
      : []
  }))
}

/**
 * Read the persisted appearance maps, falling back to the Workspace-only key an earlier build wrote.
 * @returns the three maps; empty when nothing usable is stored.
 */
export function readAppearances(): AppearanceMaps {
  const empty: AppearanceMaps = { workspaces: {}, sections: {}, sessions: {} }
  if (typeof localStorage === 'undefined') return empty
  try {
    const current: unknown = JSON.parse(localStorage.getItem(APPEARANCE_STORAGE_KEY) ?? 'null')
    if (current !== null && typeof current === 'object' && !Array.isArray(current)) {
      const source = current as Record<string, unknown>
      return {
        workspaces: readAppearanceMap(source.workspaces),
        sections: readAppearanceMap(source.sections),
        sessions: readAppearanceMap(source.sessions),
      }
    }
    return { ...empty, workspaces: readAppearanceMap(JSON.parse(localStorage.getItem(LEGACY_APPEARANCE_STORAGE_KEY) ?? '{}')) }
  } catch {
    return empty
  }
}

/**
 * Merge one appearance change into a map; an entry whose two halves are both cleared is removed.
 * @param maps - the current appearance maps.
 * @param kind - which map the identity belongs to.
 * @param id - the Workspace, Chat Section, or Session identity.
 * @param change - the halves to set; an undefined half clears that half.
 * @returns the next appearance maps.
 */
export function withAppearance(
  maps: AppearanceMaps,
  kind: AppearanceKind,
  id: string,
  change: WorkspaceAppearance,
): AppearanceMaps {
  const next = { ...maps[kind] }
  const merged = { ...next[id], ...change }
  if (merged.color === undefined && merged.icon === undefined) {
    const { [id]: _removed, ...kept } = next
    return { ...maps, [kind]: kept }
  }
  next[id] = merged
  return { ...maps, [kind]: next }
}

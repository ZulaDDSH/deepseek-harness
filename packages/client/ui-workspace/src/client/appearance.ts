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

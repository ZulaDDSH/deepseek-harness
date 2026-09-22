/**
 * Row-level rendering of a Workspace appearance choice: the color that paints
 * a row, the glyph that replaces its folder, and the Color and Icon submenus
 * every appearance entry point offers. Rows and the browser's filter share this
 * module so no two surfaces can offer different choices or colors.
 */
import { useState } from 'react'
import clsx from 'clsx'
import { IconFilterOutline16, Menu, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuItem } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkspaceBrowserProps } from '../contract/slots.ts'
import { WORKSPACE_APPEARANCE_COLORS, WORKSPACE_COLORS, WORKSPACE_ICONS } from '../appearance.ts'
import type { WorkspaceAppearance, WorkspaceColor, WorkspaceIcon } from '../appearance.ts'
import { WORKSPACE_ICON_GLYPHS } from './WorkspaceIcons.ts'
import css from './Rows.module.css'

/** The standard locale seat, prop-passed from the browser root. */
export type AppearanceTranslate = WorkspaceBrowserProps['t']

/** Menu row prefix for one color choice. */
const COLOR_PREFIX = 'appearance.color.'
/** Menu row prefix for one icon choice. */
const ICON_PREFIX = 'appearance.icon.'
/** Menu row id that clears the half it belongs to. */
const CLEAR_CHOICE = 'clear'

/**
 * Read a color out of a menu row id. The rows are built from WORKSPACE_COLORS,
 * so a known suffix is a real choice; `clear` and anything unrecognized yield
 * undefined, which clears the color rather than storing a value outside the union.
 * @param id - the selected row id, `appearance.color.<choice>`.
 * @returns the chosen color, or undefined to clear it.
 */
export function workspaceColorOf(id: string): WorkspaceColor | undefined {
  const choice = id.slice(COLOR_PREFIX.length)
  return choice === CLEAR_CHOICE ? undefined : WORKSPACE_COLORS.find(color => color === choice)
}

/**
 * Read an icon out of a menu row id, on the same terms as the color rows.
 * @param id - the selected row id, `appearance.icon.<choice>`.
 * @returns the chosen icon, or undefined to clear it.
 */
export function workspaceIconOf(id: string): WorkspaceIcon | undefined {
  const choice = id.slice(ICON_PREFIX.length)
  return choice === CLEAR_CHOICE ? undefined : WORKSPACE_ICONS.find(icon => icon === choice)
}

/**
 * Inline style painting a Workspace's chosen color onto its leading slot. The
 * row label inherits this color, so one declaration colors both the glyph and
 * the title; the default look leaves the slot to the stylesheet's alias.
 * @param appearance - the Workspace's chosen appearance, when it has one.
 * @returns the style to spread on the row, or undefined for the default look.
 */
export function appearanceStyle(appearance: WorkspaceAppearance | undefined): { color: string } | undefined {
  return appearance?.color === undefined ? undefined : { color: WORKSPACE_APPEARANCE_COLORS[appearance.color] }
}

/** One Workspace icon choice rendered from the shared icon library. */
export function WorkspaceIconGlyph({ choice }: { choice: WorkspaceIcon }) {
  const Glyph = WORKSPACE_ICON_GLYPHS[choice]
  return <Glyph size={16} />
}

/**
 * The Color and Icon submenus every appearance entry point renders, so the row
 * ellipsis and the right-click menu cannot offer different choices.
 * @param t - the row's locale seat.
 * @returns the two submenu row lists, in menu order.
 */
export function appearanceSubmenus(t: AppearanceTranslate): {
  colors: readonly MenuItem[]
  icons: readonly MenuItem[]
} {
  return {
    colors: [
      { id: `${COLOR_PREFIX}${CLEAR_CHOICE}`, label: t('appearance.default') },
      ...WORKSPACE_COLORS.map(color => ({
        id: `${COLOR_PREFIX}${color}`,
        label: t(`appearance.color.${color}`),
        icon: <span className={css.colorSwatch} style={{ background: WORKSPACE_APPEARANCE_COLORS[color] }} />,
      })),
    ],
    icons: [
      { id: `${ICON_PREFIX}${CLEAR_CHOICE}`, label: t('appearance.default') },
      ...WORKSPACE_ICONS.map(icon => ({
        id: `${ICON_PREFIX}${icon}`,
        label: t(`appearance.icon.${icon}`),
        icon: <WorkspaceIconGlyph choice={icon} />,
      })),
    ],
  }
}

/** Menu verbs that let one row change its own appearance. */
export interface SessionAppearanceActions {
  color: (color: WorkspaceColor | undefined) => void
  icon: (icon: WorkspaceIcon | undefined) => void
}

/**
 * Narrow the Workspace list by one color and one icon choice. Either half
 * clears on its own, and the menu lists every choice in vocabulary order so the
 * filter and the row menus cannot drift apart.
 * @param props.color - the active color filter, absent when unfiltered.
 * @param props.icon - the active icon filter, absent when unfiltered.
 * @param props.onColor - set or clear the color filter.
 * @param props.onIcon - set or clear the icon filter.
 * @param props.t - the browser root's locale seat.
 * @returns the filter control and its portaled menu.
 */
export function WorkspaceFilterMenu({ color, icon, onColor, onIcon, t }: {
  color: WorkspaceColor | undefined
  icon: WorkspaceIcon | undefined
  onColor: (value: WorkspaceColor | undefined) => void
  onIcon: (value: WorkspaceIcon | undefined) => void
  t: AppearanceTranslate
}) {
  const [open, setOpen] = useState(false)
  const items = [
    { type: 'label' as const, id: 'filter-colors', text: t('filter.color') },
    { id: 'color-all', label: t('filter.all') },
    ...WORKSPACE_COLORS.map(value => ({ id: `color-${value}`, label: t(`appearance.color.${value}`) })),
    { type: 'separator' as const, id: 'filter-icons-separator' },
    { type: 'label' as const, id: 'filter-icons', text: t('filter.icon') },
    { id: 'icon-all', label: t('filter.all') },
    ...WORKSPACE_ICONS.map(value => ({ id: `icon-${value}`, label: t(`appearance.icon.${value}`) })),
  ]
  return (
    <Menu
      open={open}
      onClose={() => { setOpen(false) }}
      items={items}
      selectedIds={[
        ...(color === undefined ? [] : [`color-${color}`]),
        ...(icon === undefined ? [] : [`icon-${icon}`]),
      ]}
      onSelect={(id) => {
        if (id === 'color-all') onColor(undefined)
        else if (id.startsWith('color-')) onColor(id.slice('color-'.length) as WorkspaceColor)
        else if (id === 'icon-all') onIcon(undefined)
        else if (id.startsWith('icon-')) onIcon(id.slice('icon-'.length) as WorkspaceIcon)
        setOpen(false)
      }}
      align="end"
      dense
      // Portal: the section header clips overflow, so an in-place list would
      // be cut off at the header's bounds.
      portal
      anchor={(
        <Tooltip label={t('filter.label')} side="bottom" delayMs={500}>
          <button
            type="button"
            className={clsx(css.iconButton, css.wide)}
            aria-label={t('filter.label')}
            aria-expanded={open}
            onClick={() => { setOpen(value => !value) }}
          >
            <IconFilterOutline16 />
          </button>
        </Tooltip>
      )}
    />
  )
}

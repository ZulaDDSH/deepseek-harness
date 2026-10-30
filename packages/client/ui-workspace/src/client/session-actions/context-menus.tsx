/** Structured Session actions over the workspace owner's existing callbacks. */
import type { Context } from '@deepseek-ai/cordis'
import type { RemoteEndpoint } from '@deepseek-ai/dsh-api-remote-access/client'
import type { ShortcutCommandId } from '@deepseek-ai/dsh-client-shortcuts/client'
import type { MenuAction, MenuContribution, ContextMenuTargetMap } from '@deepseek-ai/dsh-client-ui-context-menu/client'
import {
  IconEditOutlineRegular, IconFolderCloseRegular, IconFolderOpenRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import {
  WORKSPACE_APPEARANCE_COLORS, WORKSPACE_COLORS, WORKSPACE_ICONS,
} from '../appearance.ts'
import type { WorkspaceAppearance } from '../appearance.ts'
import { WORKSPACE_ICON_GLYPHS } from '../rows/WorkspaceIcons.ts'
import css from '../rows/Rows.module.css'
import type {
  ArchiveSessionInjected, ForkSessionInjected, PinSessionInjected, RenameSessionInjected, SessionIdInjected,
} from '../contract/slots.ts'

type Actions = Omit<PinSessionInjected & ArchiveSessionInjected, 'hooks'>
  & ForkSessionInjected & RenameSessionInjected & SessionIdInjected

/**
 * Register built-in actions while retaining the legacy Slot for external components.
 * @param ctx - workspace plugin context owning menus, access, membership, and locale.
 * @param actions - shared row and dialog callbacks; execution always uses the captured Session.
 */
export function registerSessionMenus(ctx: Context, actions: Actions): void {
  const t = ctx.locale.bind('workspace')
  const register = (
    id: string,
    order: number,
    endpoints: readonly RemoteEndpoint[],
    resolve: MenuContribution<'session'>['resolve'],
  ): void => {
    ctx.effect(() => ctx.contextMenus.register({
      id: `session.${id}`, target: 'session', order,
      observe: ({ sessionId }) => [
        ctx.workspaces.list, ctx.locale,
        ...endpoints.map(action => ctx.remoteAccess.source('session', sessionId, action)),
      ],
      resolve,
    }), `ui-workspace: ${id} menu`)
  }
  const allowed = (target: ContextMenuTargetMap['session'], action: RemoteEndpoint): boolean =>
    ctx.remoteAccess.source('session', target.sessionId, action).getSnapshot()
  const archived = (target: ContextMenuTargetMap['session']): boolean =>
    ctx.workspaces.list.getSnapshot().archivedSessionIds.includes(target.sessionId)
  register('pin', 100, ['workspace/pinSession', 'workspace/unpinSession'], (target) => {
    const pinned = ctx.workspaces.list.getSnapshot().pinnedSessionIds.includes(target.sessionId)
    if (archived(target) || !allowed(target, pinned ? 'workspace/unpinSession' : 'workspace/pinSession')) return []
    return [{
      id: 'pin', label: t(pinned ? 'menu.unpinSession' : 'menu.pinSession'), icon: { key: pinned ? 'workspace.unpin' : 'workspace.pin' },
      run: () => { (pinned ? actions.unpinSession : actions.pinSession)(target.sessionId) },
    }]
  })
  register('rename', 200, ['session/rename'], target => allowed(target, 'session/rename') ? [{
    id: 'rename', label: t('rename'), icon: { key: 'workspace.rename' }, commandId: 'session.rename' as ShortcutCommandId,
    run: () => { actions.requestSessionRename(target.sessionId, target.displayTitle) },
  }] : [])
  register('fork', 300, ['session/fork'], target => allowed(target, 'session/fork') ? [{
    id: 'fork', label: t('menu.fork'), icon: { key: 'workspace.fork' }, commandId: 'session.fork' as ShortcutCommandId,
    run: () => { actions.forkSession(target.sessionId) },
  }] : [])
  register('id', 450, [], target => [{
    id: 'copy', label: t('menu.sessionId'), icon: { key: 'workspace.copy' }, separatorBefore: true,
    run: () => actions.copySessionId(target.sessionId),
  }])
  register('archive', 600, ['workspace/archiveSession', 'workspace/unarchiveSession'], (target) => {
    const restoring = archived(target)
    if (!allowed(target, restoring ? 'workspace/unarchiveSession' : 'workspace/archiveSession')) return []
    return [{
      id: 'archive', label: t(restoring ? 'menu.unarchiveSession' : 'menu.archiveSession'),
      icon: { key: restoring ? 'workspace.unarchive' : 'workspace.archive' }, separatorBefore: true, afterContent: true,
      ...restoring ? {} : { commandId: 'session.archive' as ShortcutCommandId },
      run: () => { (restoring ? actions.unarchiveSession : actions.archiveSession)(target.sessionId) },
    }]
  })
}

/**
 * The Color and Icon submenus every appearance target offers; each leaf writes through the captured identity.
 * @param ctx - workspace plugin context owning the locale labels.
 * @param apply - write one appearance change for the captured target.
 * @returns the two submenu actions, color first.
 */
export function appearanceMenuActions(ctx: Context, apply: (change: WorkspaceAppearance) => void): MenuAction[] {
  const t = ctx.locale.bind('workspace')
  return [
    {
      id: 'color', label: t('appearance.color'), icon: { key: 'appearance.edit' },
      children: [
        { id: 'clear', label: t('appearance.default'), run: () => { apply({ color: undefined }) } },
        ...WORKSPACE_COLORS.map(color => ({
          id: color, label: t(`appearance.color.${color}`), icon: { key: `appearance.color.${color}` },
          run: () => { apply({ color }) },
        })),
      ],
    },
    {
      id: 'icon', label: t('appearance.icon'), icon: { key: 'appearance.edit' },
      children: [
        { id: 'clear', label: t('appearance.default'), run: () => { apply({ icon: undefined }) } },
        ...WORKSPACE_ICONS.map(icon => ({
          id: icon, label: t(`appearance.icon.${icon}`), icon: { key: `appearance.icon.${icon}` },
          run: () => { apply({ icon }) },
        })),
      ],
    },
  ]
}

/**
 * Keyed icons the appearance and Chat Section menu rows reference: color swatches, icon glyphs, and row glyphs.
 * @param ctx - workspace plugin context owning the keyed icon slot.
 */
export function registerAppearanceIcons(ctx: Context): void {
  ctx.slots.inject('contextMenu.icon', function* () {
    for (const color of WORKSPACE_COLORS) {
      yield ctx.slots.register({ name: 'contextMenu.icon', key: `appearance.color.${color}` },
        () => <span className={css.colorSwatch} style={{ background: WORKSPACE_APPEARANCE_COLORS[color] }} />)
    }
    for (const icon of WORKSPACE_ICONS) {
      const Glyph = WORKSPACE_ICON_GLYPHS[icon]
      yield ctx.slots.register({ name: 'contextMenu.icon', key: `appearance.icon.${icon}` }, () => <Glyph size={16} />)
    }
    yield ctx.slots.register({ name: 'contextMenu.icon', key: 'appearance.edit' }, IconEditOutlineRegular)
    yield ctx.slots.register({ name: 'contextMenu.icon', key: 'section.move' }, IconFolderCloseRegular)
    yield ctx.slots.register({ name: 'contextMenu.icon', key: 'section.remove' }, IconFolderOpenRegular)
  })
}

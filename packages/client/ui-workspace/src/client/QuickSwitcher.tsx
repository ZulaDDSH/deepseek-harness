/** Root quick switcher for Sessions, Workspaces, and directly executable commands. */
import { useEffect, useMemo, useState } from 'react'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import {
  IconFolderOpenOutline16, IconNewChatOutline16, IconPlayOutline16, IconSearchOutline16,
  Input, Modal,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceKey } from './locales.ts'
import css from './QuickSwitcher.module.css'

/** One command row the root switcher can execute without editing the composer draft. */
export interface QuickCommand {
  readonly name: string
  readonly label?: string
  readonly description?: string
  readonly kind: 'run' | 'popup'
}

/** Root actions injected by the workspace plugin into the quick-switcher surface. */
export interface QuickSwitcherInjected {
  openSession: (sessionId: SessionId) => void
  openWorkspace: (workspaceId: WorkspaceId) => Promise<void>
  quickCommands: (sessionId: SessionId, query: string, signal: AbortSignal) => Promise<readonly QuickCommand[]>
  runQuick: (sessionId: SessionId, name: string) => boolean
}

/** Composed root-slot props for {@link QuickSwitcher}. */
export type QuickSwitcherProps =
  PropsRuntime<'shell.overlay'>
  & InjectFace<QuickSwitcherInjected>
  & PropsLocale<'workspace'>

type SwitcherRow =
  | { key: string; kind: 'session'; title: string; detail?: string; sessionId: SessionId }
  | { key: string; kind: 'workspace'; title: string; detail?: string; workspaceId: WorkspaceId }
  | { key: string; kind: 'command'; title: string; detail?: string; command: QuickCommand }

function includes(text: string | undefined, query: string): boolean {
  return text?.toLocaleLowerCase().includes(query) ?? false
}

function iconFor(kind: SwitcherRow['kind']) {
  switch (kind) {
    case 'session': return <IconNewChatOutline16 />
    case 'workspace': return <IconFolderOpenOutline16 />
    case 'command': return <IconPlayOutline16 />
  }
}

/**
 * Keyboard-first switcher that never writes into the composer draft.
 * @param props - root standard hooks, navigation actions, command actions, and locale seat.
 * @returns the dormant shortcut listener or the open quick-switcher modal.
 */
export function QuickSwitcher({
  useSessions, useWorkspaces, openSession, openWorkspace, quickCommands, runQuick, t,
}: QuickSwitcherProps) {
  const sessions = useSessions(value => value)
  const workspaces = useWorkspaces(value => value)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [commands, setCommands] = useState<readonly QuickCommand[]>([])
  const [commandBusy, setCommandBusy] = useState(false)
  const [active, setActive] = useState(0)
  const currentSessionId = useMemo(
    () => Object.values(sessions.byId).find(row => (row.retainedBy.mainView ?? 0) > 0)?.id,
    [sessions],
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key.toLocaleLowerCase() !== 'k' || (!event.metaKey && !event.ctrlKey)) return
      event.preventDefault()
      setOpen(value => !value)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('keydown', onKeyDown) }
  }, [])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setActive(0)
  }, [open])

  useEffect(() => {
    if (!open || currentSessionId === undefined) {
      setCommands([])
      setCommandBusy(false)
      return
    }
    const abort = new AbortController()
    setCommandBusy(true)
    void quickCommands(currentSessionId, query, abort.signal).then(
      value => {
        if (!abort.signal.aborted) {
          setCommands(value)
          setCommandBusy(false)
        }
      },
      () => {
        if (!abort.signal.aborted) {
          setCommands([])
          setCommandBusy(false)
        }
      },
    )
    return () => { abort.abort() }
  }, [open, query, currentSessionId, quickCommands])

  const normalized = query.trim().toLocaleLowerCase()
  const archived = new Set(workspaces.archivedSessionIds)
  const sessionRows = sessions.ids
    .map(id => sessions.byId[id])
    .filter(row => row !== undefined && !archived.has(row.id) && row.origin !== 'subagent')
    .filter(row => normalized === '' || includes(row.displayTitle, normalized) || includes(row.cwd, normalized))
    .slice(0, 8)
    .map((row): SwitcherRow => ({
      key: `session:${row.id}`,
      kind: 'session',
      title: row.displayTitle,
      ...(row.cwd === undefined ? {} : { detail: row.cwd }),
      sessionId: row.id,
    }))
  const workspaceRows = workspaces.items
    .filter(row => normalized === ''
      || includes(row.title, normalized)
      || includes(row.path, normalized))
    .slice(0, 6)
    .map((row): SwitcherRow => ({
      key: `workspace:${row.workspaceId}`,
      kind: 'workspace',
      title: row.title,
      detail: row.path,
      workspaceId: row.workspaceId,
    }))
  const commandRows = commands.slice(0, 8).map((command): SwitcherRow => ({
    key: `command:${command.name}`,
    kind: 'command',
    title: command.label ?? `/${command.name}`,
    detail: command.description,
    command,
  }))
  const rows = [...sessionRows, ...workspaceRows, ...commandRows]
  const selected = rows.length === 0 ? 0 : Math.min(active, rows.length - 1)

  useEffect(() => {
    if (active !== selected) setActive(selected)
  }, [active, selected])

  const choose = (row: SwitcherRow): void => {
    setOpen(false)
    switch (row.kind) {
      case 'session':
        openSession(row.sessionId)
        break
      case 'workspace':
        void openWorkspace(row.workspaceId)
        break
      case 'command':
        if (currentSessionId !== undefined) runQuick(currentSessionId, row.command.name)
        break
    }
  }

  return (
    <Modal open={open} onClose={() => { setOpen(false) }} title={t('quick.title')} headless>
      <div className={css.card} onKeyDown={(event) => {
        if (event.key === 'ArrowDown') {
          event.preventDefault()
          if (rows.length > 0) setActive(index => (index + 1) % rows.length)
        } else if (event.key === 'ArrowUp') {
          event.preventDefault()
          if (rows.length > 0) setActive(index => (index + rows.length - 1) % rows.length)
        } else if (event.key === 'Enter' && rows[selected] !== undefined) {
          event.preventDefault()
          choose(rows[selected])
        }
      }}>
        <Input
          icon={<IconSearchOutline16 />}
          value={query}
          onChange={event => {
            setQuery(event.currentTarget.value)
            setActive(0)
          }}
          placeholder={t('quick.placeholder')}
          aria-label={t('quick.placeholder')}
          autoComplete="off"
          autoFocus
        />
        <div className={css.results}>
          {sessionRows.length > 0 && <div className={css.heading}>{t('quick.sessions')}</div>}
          {sessionRows.map(row => (
            <SwitcherItem key={row.key} row={row} active={rows[selected]?.key === row.key} onChoose={choose} />
          ))}
          {workspaceRows.length > 0 && <div className={css.heading}>{t('quick.workspaces')}</div>}
          {workspaceRows.map(row => (
            <SwitcherItem key={row.key} row={row} active={rows[selected]?.key === row.key} onChoose={choose} />
          ))}
          {(commandRows.length > 0 || commandBusy) && <div className={css.heading}>{t('quick.commands')}</div>}
          {commandRows.map(row => (
            <SwitcherItem key={row.key} row={row} active={rows[selected]?.key === row.key} onChoose={choose} />
          ))}
          {rows.length === 0 && !commandBusy && <div className={css.empty}>{t('quick.empty')}</div>}
          {rows.length === 0 && commandBusy && <div className={css.empty}>{t('quick.loading')}</div>}
        </div>
        <div className={css.footer}><span>↑↓</span><span>{t('quick.navigate')}</span><span>↵</span><span>{t('quick.open')}</span></div>
      </div>
    </Modal>
  )
}

function SwitcherItem({ row, active, onChoose }: {
  row: SwitcherRow
  active: boolean
  onChoose: (row: SwitcherRow) => void
}) {
  return (
    <button
      type="button"
      className={active ? `${css.row} ${css.active}` : css.row}
      onClick={() => { onChoose(row) }}
    >
      <span className={css.icon}>{iconFor(row.kind)}</span>
      <span className={css.copy}>
        <span className={css.title}>{row.title}</span>
        {row.detail !== undefined && <span className={css.detail}>{row.detail}</span>}
      </span>
      {row.kind === 'command' && <span className={css.commandKind}>{row.command.kind === 'popup' ? '…' : '↵'}</span>}
    </button>
  )
}

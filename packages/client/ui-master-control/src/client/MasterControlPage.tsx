import type { ExternalChatCatalog, ExternalChatImportValue, ExternalChatKey } from '@deepseek-ai/dsh-api-session-controller/client'
import { ImportChats } from './ImportChats.tsx'
import { useMemo, useState } from 'react'
import clsx from 'clsx'
import {
  Button, Input, Pill, IconStopFillRegular, StateDot, relativeTime, type StateDotState,
  IconChevronDownOutlineRegular, IconChevronRightOutlineRegular, IconFolderOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { groupMasterRows, masterRows, type RowState } from './rows.ts'
import css from './MasterControlPage.module.css'

export interface MasterControlInjected {
  discover: () => Promise<ExternalChatCatalog>
  importChats: (keys: readonly ExternalChatKey[]) => Promise<ExternalChatImportValue>
  open: (sessionId: string) => void
  interrupt: (sessionId: string) => Promise<void>
  openMasterChat: () => Promise<void>
}

export type MasterControlPageProps =
  PropsRuntime<'main'> & PropsLocale<'masterControl'> & InjectFace<MasterControlInjected>

const DOT: Record<RowState, StateDotState> = { attention: 'warning', failed: 'error', running: 'ongoing', idle: 'idle' }

export function MasterControlPage({
  useSessions, useSessionStatus, useWorkspaces, open, interrupt, openMasterChat, discover, importChats, t,
}: MasterControlPageProps) {
  const list = useSessions(state => state)
  const status = useSessionStatus(snapshot => snapshot)
  const rows = useMemo(() => masterRows(list, status), [list, status])
  const workspaces = useWorkspaces(snapshot => snapshot.items)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<RowState | 'all'>('all')
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState<string>()
  const [importOpen, setImportOpen] = useState(false)
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})
  const groups = useMemo(() => groupMasterRows(rows, workspaces, query, filter), [rows, workspaces, query, filter])
  const now = Date.now()

  const stats = useMemo(() => {
    let running = 0
    let attention = 0
    let failed = 0
    let idle = 0
    for (const r of rows) {
      if (r.state === 'running') running++
      else if (r.state === 'attention') attention++
      else if (r.state === 'failed') failed++
      else idle++
    }
    return { total: rows.length, running, attention, failed, idle }
  }, [rows])

  const toggleGroup = (key: string) => {
    setCollapsedGroups(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const expandAll = () => { setCollapsedGroups({}) }
  const collapseAll = () => {
    const allCollapsed: Record<string, boolean> = {}
    for (const g of groups) allCollapsed[g.key] = true
    setCollapsedGroups(allCollapsed)
  }

  return (
    <div className={css.page}>
      <header className={css.header}>
        <div className={css.headerContent}>
          <h1 className={css.title}>{t('title')}</h1>
          <p className={css.intro}>{t('intro')}</p>
        </div>
        <div className={css.headerActions}>
          <Button size="sm" disabled={opening} onClick={() => {
            setOpening(true)
            setError(undefined)
            openMasterChat().catch((failure: unknown) => { setError(String(failure)) }).finally(() => { setOpening(false) })
          }}>
            {t('openMasterChat')}
          </Button>
          <Button size="sm" onClick={() => { setImportOpen(o => !o) }}>
            {t('importChats')}
          </Button>
        </div>
      </header>
      {error !== undefined && <p role="alert">{error}</p>}

      {importOpen && (
        <ImportChats
          discover={discover}
          importChats={importChats}
          open={open}
          t={t}
          visible={importOpen}
          setVisible={setImportOpen}
        />
      )}

      {rows.length > 0 && (
        <div className={css.statsBar}>
          <div className={clsx(css.statCard, filter === 'all' && css.statCardActive)} onClick={() => { setFilter('all') }}>
            <span className={css.statNumber}>{stats.total}</span>
            <span className={css.statLabel}>{t('totalSessions')}</span>
          </div>
          <div className={clsx(css.statCard, filter === 'running' && css.statCardActive)} onClick={() => { setFilter('running') }}>
            <span className={css.statNumber}>
              <StateDot state="ongoing" /> {stats.running}
            </span>
            <span className={css.statLabel}>{t('runningSessions')}</span>
          </div>
          <div className={clsx(css.statCard, filter === 'attention' && css.statCardActive)} onClick={() => { setFilter('attention') }}>
            <span className={css.statNumber}>
              <StateDot state="warning" /> {stats.attention}
            </span>
            <span className={css.statLabel}>{t('attentionSessions')}</span>
          </div>
          <div className={clsx(css.statCard, filter === 'idle' && css.statCardActive)} onClick={() => { setFilter('idle') }}>
            <span className={css.statNumber}>
              <StateDot state="idle" /> {stats.idle}
            </span>
            <span className={css.statLabel}>{t('idleSessions')}</span>
          </div>
        </div>
      )}

      <div className={css.filtersRow}>
        <div className={css.filters}>
          <Input aria-label={t('search')} placeholder={t('search')} value={query} onChange={(event) => { setQuery(event.target.value) }} />
          {(['all', 'running', 'attention', 'failed', 'idle'] as const).map(state => (
            <Pill key={state} active={filter === state} aria-pressed={filter === state} onClick={() => { setFilter(state) }}>
              {t(state === 'all' ? 'all' : `status.${state}`)}
            </Pill>
          ))}
        </div>
        {groups.length > 0 && (
          <div className={css.toggleAllActions}>
            <Button size="sm" onClick={expandAll}>{t('expandAll')}</Button>
            <Button size="sm" onClick={collapseAll}>{t('collapseAll')}</Button>
          </div>
        )}
      </div>

      {rows.length > 0 && groups.length === 0 && <p className={css.noMatches}>{t('noMatches')}</p>}
      {rows.length === 0
        ? <p className={css.empty}>{t(list.phase === 'ready' ? 'empty' : 'loading')}</p>
        : (
          <div className={css.groupsContainer}>
            {groups.map((group) => {
              const isCollapsed = collapsedGroups[group.key] === true
              const runningInGroup = group.rows.filter(r => r.state === 'running').length
              const attentionInGroup = group.rows.filter(r => r.state === 'attention').length
              return (
                <section key={group.key} className={css.groupCard}>
                  <div
                    className={clsx(css.groupHeader, !isCollapsed && css.groupHeaderExpanded)}
                    role="button"
                    tabIndex={0}
                    aria-expanded={!isCollapsed}
                    onClick={() => { toggleGroup(group.key) }}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleGroup(group.key) } }}
                  >
                    <div className={css.groupTitleArea}>
                      <span className={css.chevronIcon}>
                        {isCollapsed ? <IconChevronRightOutlineRegular size={14} /> : <IconChevronDownOutlineRegular size={14} />}
                      </span>
                      <IconFolderOutlineRegular size={16} />
                      <h2 className={css.groupTitle}>{group.key === '' ? t('ungrouped') : group.title}</h2>
                      {group.path !== undefined && <span className={css.groupCwd} title={group.path}>{group.path}</span>}
                    </div>
                    <div className={css.groupBadges}>
                      {runningInGroup > 0 && (
                        <span className={clsx(css.badge, css.badgeRunning)}>
                          <StateDot state="ongoing" /> {runningInGroup} {t('status.running')}
                        </span>
                      )}
                      {attentionInGroup > 0 && (
                        <span className={clsx(css.badge, css.badgeAttention)}>
                          <StateDot state="warning" /> {attentionInGroup}
                        </span>
                      )}
                      <span className={css.badge}>{t('sessionCount', { n: group.rows.length })}</span>
                    </div>
                  </div>
                  {!isCollapsed && (
                    <div className={css.tableWrapper}>
                      <table className={css.table}>
                        <thead>
                          <tr>
                            <th>{t('col.session')}</th>
                            <th>{t('col.status')}</th>
                            <th>{t('col.updated')}</th>
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {group.rows.map((row) => {
                            const rel = relativeTime(row.updatedAt, now)
                            return (
                              <tr key={row.id}>
                                <td>
                                  <div className={css.name}>{row.title}</div>
                                  {row.cwd !== undefined && <div className={css.cwd}>{row.cwd}</div>}
                                </td>
                                <td>
                                  <span className={css.state}>
                                    <StateDot state={DOT[row.state]} />
                                    {t(`status.${row.state}`)}
                                  </span>
                                </td>
                                <td>{rel.unit === 'now' ? t('time.now') : t(`time.${rel.unit}`, { n: rel.n })}</td>
                                <td className={css.actions}>
                                  <Button size="sm" onClick={() => { open(row.id) }}>{t('open')}</Button>
                                  {row.state === 'running' && (
                                    <Button size="sm" icon={<IconStopFillRegular />} onClick={() => { interrupt(row.id).catch((err: unknown) => { console.error(err) }) }}>
                                      {t('interrupt')}
                                    </Button>
                                  )}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              )
            })}
          </div>
        )}
    </div>
  )
}

import type { ExternalChatCatalog, ExternalChatImportValue, ExternalChatKey } from '@deepseek-ai/dsh-api-session-controller/client'
import { ImportChats } from './ImportChats.tsx'
import { useMemo, useState } from 'react'
import { Button, Input, Pill, IconStopFillRegular, StateDot, relativeTime, type StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
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
  const groups = useMemo(() => groupMasterRows(rows, workspaces, query, filter), [rows, workspaces, query, filter])
  const now = Date.now()
  return (
    <div className={css.page}>
      <header>
        <h1 className={css.title}>{t('title')}</h1>
        <p className={css.intro}>{t('intro')}</p>
        <div className={css.actions}>
          <Button size="sm" disabled={opening} onClick={() => {
            setOpening(true)
            setError(undefined)
            openMasterChat().catch((failure: unknown) => { setError(String(failure)) }).finally(() => { setOpening(false) })
          }}>
            {t('openMasterChat')}
          </Button>
        </div>
      </header>
      {error !== undefined && <p role="alert">{error}</p>}
      <ImportChats discover={discover} importChats={importChats} open={open} t={t} />
      <div className={css.filters}>
        <Input aria-label={t('search')} placeholder={t('search')} value={query} onChange={(event) => { setQuery(event.target.value) }} />
        {(['all', 'running', 'attention', 'failed', 'idle'] as const).map(state => <Pill key={state} active={filter === state}
          aria-pressed={filter === state} onClick={() => { setFilter(state) }}>{t(state === 'all' ? 'all' : `status.${state}`)}</Pill>)}
      </div>
      {rows.length > 0 && groups.length === 0 && <p>{t('noMatches')}</p>}
      {rows.length === 0
        ? <p className={css.empty}>{t(list.phase === 'ready' ? 'empty' : 'loading')}</p>
        : (
          <div>
            {groups.map(group => <section key={group.key} className={css.group}>
              <h2>{group.key === '' ? t('ungrouped') : group.title}</h2>
              {group.path !== undefined && <p className={css.cwd}>{group.path}</p>}
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
                            <Button size="sm" icon={<IconStopFillRegular />} onClick={() => { interrupt(row.id).catch((error: unknown) => { console.error(error) }) }}>
                              {t('interrupt')}
                            </Button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </section>)}
          </div>
        )}
    </div>
  )
}

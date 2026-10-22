import { useMemo } from 'react'
import { Button, IconStopFill16, StateDot, relativeTime, type StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { masterRows, type RowState } from './rows.ts'
import css from './MasterControlPage.module.css'

export interface MasterControlInjected {
  open: (sessionId: string) => void
  interrupt: (sessionId: string) => Promise<void>
}

export type MasterControlPageProps =
  PropsRuntime<'main'> & PropsLocale<'masterControl'> & InjectFace<MasterControlInjected>

const DOT: Record<RowState, StateDotState> = { attention: 'warning', failed: 'error', running: 'ongoing', idle: 'idle' }

export function MasterControlPage({ useSessions, useSessionStatus, open, interrupt, t }: MasterControlPageProps) {
  const list = useSessions(state => state)
  const status = useSessionStatus(snapshot => snapshot)
  const rows = useMemo(() => masterRows(list, status), [list, status])
  const now = Date.now()
  return (
    <div className={css.page}>
      <header>
        <h1 className={css.title}>{t('title')}</h1>
        <p className={css.intro}>{t('intro')}</p>
      </header>
      {rows.length === 0
        ? <p className={css.empty}>{t(list.phase === 'ready' ? 'empty' : 'loading')}</p>
        : (
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
              {rows.map((row) => {
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
                        <Button size="sm" icon={<IconStopFill16 />} onClick={() => { interrupt(row.id).catch((error: unknown) => { console.error(error) }) }}>
                          {t('interrupt')}
                        </Button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
    </div>
  )
}

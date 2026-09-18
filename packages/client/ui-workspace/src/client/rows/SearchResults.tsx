/** Search result projection for the Workspace browser. */
import { useMemo } from 'react'
import clsx from 'clsx'
import type { SessionSearchResultItem } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { WorkspaceBrowserProps } from '../contract/slots.ts'
import type { SessionNode } from '../tree.ts'
import { deriveSearchResults } from '../tree.ts'
import { SearchResultItem } from './Rows.tsx'
import css from './WorkspaceBrowser.module.css'

/** Current Host search request state paired with the query that produced it. */
export interface RemoteSearchState {
  query: string
  status: 'idle' | 'loading' | 'ready' | 'error'
  items: readonly SessionSearchResultItem[]
  hasMore: boolean
}

/**
 * Render local metadata matches merged with the current Host search result page.
 * @param props - search query, remote state, Workspace projection, and standard hooks.
 * @returns the flat search result body and request status.
 */
export function SearchResults({
  useSessions,
  useSessionStatus,
  open,
  workspaces,
  archivedSessionIds,
  query,
  remote,
  resultLimit,
  usePanelInfo,
  t,
}: Pick<WorkspaceBrowserProps, 'useSessions' | 'useSessionStatus' | 'open' | 't' | 'usePanelInfo'> & {
  workspaces: readonly WorkspaceView[]
  archivedSessionIds: readonly SessionNode['id'][]
  query: string
  remote: RemoteSearchState
  resultLimit: number
}) {
  const panelActive = usePanelInfo(info => info.activePanelId !== null)
  const list = useSessions(s => s)
  const statuses = useSessionStatus(s => s)
  const currentRemote = remote.query === query
    ? remote
    : { query, status: 'loading' as const, items: [], hasMore: false }
  const results = useMemo(
    () => deriveSearchResults(
      list,
      workspaces,
      query,
      archivedSessionIds,
      statuses,
      currentRemote,
      resultLimit,
    ),
    [list, workspaces, query, archivedSessionIds, statuses, currentRemote, resultLimit],
  )
  const pending = currentRemote.status === 'loading'
  const failed = currentRemote.status === 'error'
  const currentId = panelActive
    ? undefined
    : Object.values(list.byId).find(session => (session.retainedBy.mainView ?? 0) > 0)?.id

  return (
    <div className={clsx(css.treeBody, css.wide)}>
      <div className={css.list}>
        <div className={css.searchTree} role="tree" aria-label={t('search.results.aria')}>
          {results.items.map(result => (
            <SearchResultItem
              key={result.id}
              result={result}
              currentId={currentId}
              onOpen={open}
              t={t}
            />
          ))}
        </div>
        {pending && <div className={css.searchStatus} role="status">{t('search.pending')}</div>}
        {failed && <div className={css.searchWarning} role="status">{t('search.unavailable')}</div>}
        {!pending && results.items.length === 0 && (
          <div className={css.empty}>{t('search.noMatches')}</div>
        )}
        {results.hasMore && (
          <div className={css.searchStatus}>
            {t('search.hasMore', { n: resultLimit })}
          </div>
        )}
      </div>
      <span className={css.fade} />
    </div>
  )
}

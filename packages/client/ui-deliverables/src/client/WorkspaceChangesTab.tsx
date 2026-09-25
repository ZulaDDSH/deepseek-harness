/**
 * The `workspace-changes` body: the Workspace's whole Git working tree in the
 * right Sidebar — every changed file above the selected file's comparison.
 *
 * A page type rather than a resource type: the Workspace selects the content,
 * so the body resolves the Workspace whose path matches the Session's working
 * directory and falls back to the first registered one.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Button, IconRefreshOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import { workspaceDiffUrl, workspaceStatusUrl } from '../changes.ts'
import { FileDiff } from './FileDiff.tsx'
import type { WorkspaceDiffStore, WorkspaceDiffState } from './workspace-diff.ts'
import type { WorkspaceStatusStore } from './workspace-status.ts'
import { NS } from './locales.ts'
import css from './WorkspaceChangesTab.module.css'

/** Status reads and current-diff reads supplied by the plugin body. */
export interface WorkspaceChangesInjected {
  hooks: {
    workspaceStatus: ObservableSnapshot<ReturnType<WorkspaceStatusStore['state']['getSnapshot']>>
    workspaceDiff: ObservableSnapshot<ReturnType<WorkspaceDiffStore['state']['getSnapshot']>>
  }
  loadStatus: WorkspaceStatusStore['load']
  refreshStatus: WorkspaceStatusStore['refresh']
  loadDiff: WorkspaceDiffStore['load']
}

/** The body's composed props: the tab it draws and its injected face. */
export type WorkspaceChangesTabProps =
  & PropsRuntime<'sidebar.right.pane.tab'>
  & InjectFace<WorkspaceChangesInjected>
  & PropsLocale<typeof NS>

/**
 * The Workspace review body.
 * @param props - composed slot props.
 * @returns the changed-file list and the selected file's comparison.
 */
export function WorkspaceChangesTab({
  sessionId, useSessions, useWorkspaces, useWorkspaceStatus, useWorkspaceDiff,
  loadStatus, refreshStatus, loadDiff, t,
}: WorkspaceChangesTabProps): ReactNode {
  const workspaces = useWorkspaces(state => state.items)
  const cwd = useSessions(state => state.byId[sessionId]?.cwd)
  const selectedWorkspace = useMemo(() => {
    const matching = workspaces.find(workspace => workspace.path === cwd)
    return matching ?? workspaces[0]
  }, [cwd, workspaces])
  const [selectedId, setSelectedId] = useState<WorkspaceId | undefined>(selectedWorkspace?.workspaceId)
  useEffect(() => {
    if (selectedWorkspace !== undefined && !workspaces.some(workspace => workspace.workspaceId === selectedId)) {
      setSelectedId(selectedWorkspace.workspaceId)
    }
  }, [selectedWorkspace, selectedId, workspaces])
  const statusUrl = selectedId === undefined ? undefined : workspaceStatusUrl(selectedId)
  const statusState = useWorkspaceStatus(value => statusUrl === undefined ? undefined : value[statusUrl])
  useEffect(() => {
    if (selectedId !== undefined && statusState === undefined) void loadStatus(selectedId)
  }, [selectedId, statusState, loadStatus])
  const files = typeof statusState === 'object' ? statusState.files : []
  const [selectedIndex, setSelectedIndex] = useState(0)
  useEffect(() => {
    if (selectedIndex >= files.length) setSelectedIndex(0)
  }, [files.length, selectedIndex])
  const file = files[selectedIndex]
  const diffUrl = selectedId === undefined || file === undefined
    ? undefined
    : workspaceDiffUrl(selectedId, selectedIndex)
  const diffState = useWorkspaceDiff(value => diffUrl === undefined ? undefined : value[diffUrl])
  useEffect(() => {
    if (selectedId !== undefined && file !== undefined && diffState === undefined) void loadDiff(selectedId, selectedIndex)
  }, [selectedId, file, diffState, selectedIndex, loadDiff])

  return <div className={css.page} data-source-changes>
    <header className={css.header}>
      <div className={css.summary}>
        <span>{typeof statusState === 'object' ? t('source.changed', { count: String(statusState.total) }) : t('source.title')}</span>
        {typeof statusState === 'object' && <>
          <span className={css.added}>{t('changes.added', { count: String(statusState.added) })}</span>
          <span className={css.deleted}>{t('changes.deleted', { count: String(statusState.deleted) })}</span>
        </>}
      </div>
      {selectedId !== undefined && <Button size="sm" aria-label={t('source.refresh')} title={t('source.refresh')}
        onClick={() => { void refreshStatus(selectedId) }}>
        <IconRefreshOutlineRegular />
      </Button>}
    </header>
    {typeof statusState === 'object' && statusState.branch !== undefined
      && <p className={css.branch}>{statusState.branch}</p>}
    {workspaces.length === 0 && <p className={css.status}>{t('source.noWorkspace')}</p>}
    {workspaces.length > 1 && <label className={css.workspaceSelect}>
      <span>{t('source.workspace')}</span>
      <select value={selectedId ?? ''} onChange={(event) => { setSelectedId(event.target.value as WorkspaceId) }}>
        {workspaces.map(workspace => <option key={workspace.workspaceId} value={workspace.workspaceId}>{workspace.title}</option>)}
      </select>
    </label>}
    {statusState === 'loading' && <p className={css.status} role="status">{t('source.loading')}</p>}
    {statusState === 'error' && <div className={css.status}><span>{t('source.error')}</span>{selectedId !== undefined && <Button size="sm"
      onClick={() => { void refreshStatus(selectedId) }}>{t('presented.retry')}</Button>}</div>}
    {statusState === 'missing' && <p className={css.status}>{t('source.noRepository')}</p>}
    {typeof statusState === 'object' && <>
      <div className={css.files} role="list" aria-label={t('source.files')}>
        {files.map((entry, index) => <button key={`${entry.path}:${index}`} type="button" className={css.file} data-selected={index === selectedIndex || undefined}
          onClick={() => { setSelectedIndex(index) }}>
          <span className={css.marker}>{markerOf(entry.index, entry.worktree)}</span>
          <span className={css.path} title={entry.display}>{entry.display}</span>
          <span className={css.counts}>
            {entry.binary === true ? t('changes.binary') : <><span className={css.added}>{t('changes.added', { count: String(entry.added) })}</span><span className={css.deleted}>{t('changes.deleted', { count: String(entry.deleted) })}</span></>}
          </span>
        </button>)}
        {files.length === 0 && <p className={css.status}>{t('source.clean')}</p>}
      </div>
      <div className={css.diff}>
        {file === undefined && <p className={css.status}>{t('source.selectFile')}</p>}
        {file !== undefined && <SourceDiff state={diffState}
          retry={() => { if (selectedId !== undefined) void loadDiff(selectedId, selectedIndex) }} t={t} />}
      </div>
    </>}
  </div>
}

/** The working-tree marker for one file: untracked, then the index state, then the worktree state. */
function markerOf(index: string, worktree: string): string {
  if (index === '?' || worktree === '?') return '?'
  if (index !== ' ') return index
  if (worktree !== ' ') return worktree
  return 'M'
}

/** The selected file's comparison, or the state that stands in for it. */
function SourceDiff({ state, retry, t }: { state: WorkspaceDiffState | undefined; retry: () => void } & PropsLocale<typeof NS>): ReactNode {
  if (state === undefined || state === 'loading') return <p className={css.status} role="status">{t('diff.loading')}</p>
  if (state === 'missing') return <p className={css.status}>{t('diff.missing')}</p>
  if (state === 'error') return <div className={css.status}><span>{t('diff.error')}</span><Button size="sm" onClick={retry}>{t('presented.retry')}</Button></div>
  if (state.kind === 'binary') return <p className={css.status}>{t('diff.binary')}</p>
  if (state.kind === 'oversized') return <p className={css.status}>{t('diff.oversized')}</p>
  return <FileDiff state={state} split={false} wrap={false} retry={retry} t={t} />
}

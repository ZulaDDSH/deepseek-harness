/** Fetch-once cache for current git status of registered Workspaces. */
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { isWorkspaceStatus, workspaceStatusUrl, type WorkspaceStatusValue } from '../changes.ts'
import { HostReadStore } from './host-read-store.ts'

/** Status read state. */
export type WorkspaceStatusState = WorkspaceStatusValue | 'missing' | 'error' | 'loading'

/** Host status reads with explicit refresh for a Source Control panel. */
export class WorkspaceStatusStore extends HostReadStore<WorkspaceStatusState> {
  constructor() {
    super({
      loading: 'loading',
      failed: 'error',
      retryable: state => state === 'error',
      decode: async (response) => {
        if (response.status === 404) return 'missing'
        if (!response.ok) return 'error'
        const value: unknown = await response.json()
        return isWorkspaceStatus(value) ? value : 'error'
      },
    })
  }

  /** Read one Workspace status unless a cached answer already exists. */
  load(workspaceId: WorkspaceId): Promise<void> {
    return this.loadUrl(workspaceStatusUrl(workspaceId))
  }

  /** Forget one cached status before reading it again. */
  refresh(workspaceId: WorkspaceId): Promise<void> {
    const url = workspaceStatusUrl(workspaceId)
    this.state.update(state => Object.fromEntries(Object.entries(state).filter(([key]) => key !== url)))
    return this.load(workspaceId)
  }
}

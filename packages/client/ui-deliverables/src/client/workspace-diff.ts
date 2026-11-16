/** Fetch-once cache for current git comparisons of registered Workspace files. */
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import { isChangesDiff, workspaceDiffUrl, type WorkspaceDiff } from '../changes.ts'
import { HostReadStore } from './host-read-store.ts'

/** Current workspace comparison read state. */
export type WorkspaceDiffState = WorkspaceDiff | 'missing' | 'error' | 'loading'

/** Host comparison reads keyed by Workspace and current status-file index. */
export class WorkspaceDiffStore extends HostReadStore<WorkspaceDiffState> {
  constructor() {
    super({
      loading: 'loading',
      failed: 'error',
      retryable: state => state === 'error',
      decode: async (response) => {
        if (response.status === 404) return 'missing'
        if (!response.ok) return 'error'
        const value: unknown = await response.json()
        return isChangesDiff(value) ? value : 'error'
      },
    })
  }

  /**
   * Read one current comparison unless a cached answer already exists.
   * @param workspaceId - registered Workspace identity.
   * @param index - status-file index to compare.
   */
  load(workspaceId: WorkspaceId, index: number): Promise<void> {
    return this.loadUrl(workspaceDiffUrl(workspaceId, index))
  }
}

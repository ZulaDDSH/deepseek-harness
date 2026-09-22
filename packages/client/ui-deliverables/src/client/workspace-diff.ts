/**
 * Fetch-once cache for current git comparisons of registered Workspace files.
 *
 * The Host addresses a comparison by the file's position in the status list it
 * just answered with, so a position identifies a file only together with the
 * status list it came from. A comparison is therefore cached under the status
 * generation as well as the index; without it a refresh that reorders or
 * replaces the list leaves an earlier file's comparison standing at a position
 * another file now occupies.
 */
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { isChangesDiff, workspaceDiffUrl, type WorkspaceDiff } from '../changes.ts'
import { HostReadStore } from './host-read-store.ts'

/** Current workspace comparison read state. */
export type WorkspaceDiffState = WorkspaceDiff | 'missing' | 'error' | 'loading'

/** Host comparison reads keyed by Workspace, status generation, and status-file index. */
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
   * The cache key one comparison is read and found under.
   * @param workspaceId - registered Workspace identity.
   * @param filePath - the status file's repository-relative path.
   * @param generation - generation of the status list the index was read from.
   * @param index - the file's position in that status list.
   * @returns the key distinguishing this comparison from every other one.
   */
  static keyOf(workspaceId: WorkspaceId, filePath: string, generation: number, index: number): string {
    return `${workspaceDiffUrl(workspaceId, index)}&path=${encodeURIComponent(filePath)}&generation=${generation}`
  }

  /**
   * Read one current comparison unless the same file's answer already exists.
   * @param workspaceId - registered Workspace identity.
   * @param filePath - the status file's repository-relative path.
   * @param generation - generation of the status list the index was read from.
   * @param index - status-file index to compare.
   */
  load(workspaceId: WorkspaceId, filePath: string, generation: number, index: number): Promise<void> {
    return this.loadUrl(WorkspaceDiffStore.keyOf(workspaceId, filePath, generation, index))
  }
}

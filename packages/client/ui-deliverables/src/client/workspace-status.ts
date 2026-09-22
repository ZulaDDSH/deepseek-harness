/** Fetch-once cache for current git status of registered Workspaces, with the generation each status list belongs to. */
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { isWorkspaceStatus, workspaceStatusUrl, type WorkspaceStatusValue } from '../changes.ts'
import { HostReadStore } from './host-read-store.ts'

/** Status read state. */
export type WorkspaceStatusState = WorkspaceStatusValue | 'missing' | 'error' | 'loading'

/** Host status reads with explicit refresh for a Source Control panel. */
export class WorkspaceStatusStore extends HostReadStore<WorkspaceStatusState> {
  /**
   * Counts every status published for a status URL. A comparison is addressed
   * by a file's position in one status list, so the generation is what
   * identifies the list that position was read against: once it advances, an
   * index names a file in a different list and no earlier comparison for that
   * index may be reused.
   */
  private readonly generations = new Map<string, number>()

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

  /**
   * Read one Workspace status unless a cached answer already exists.
   * @param workspaceId - registered Workspace identity.
   */
  load(workspaceId: WorkspaceId): Promise<void> {
    return this.loadUrl(workspaceStatusUrl(workspaceId))
  }

  /**
   * The generation of the status list standing for one Workspace.
   * @param workspaceId - registered Workspace identity.
   * @returns the generation that current status list was published in.
   */
  generationOf(workspaceId: WorkspaceId): number {
    return this.generations.get(workspaceStatusUrl(workspaceId)) ?? 0
  }

  /**
   * Forget one cached status before reading it again, and advance its
   * generation so every comparison read against the previous list is
   * re-read rather than reused at the position it occupied there.
   * @param workspaceId - registered Workspace identity.
   */
  refresh(workspaceId: WorkspaceId): Promise<void> {
    const url = workspaceStatusUrl(workspaceId)
    this.generations.set(url, this.generationOf(workspaceId) + 1)
    // Clearing the key to undefined is what loadUrl reads as "no cached answer":
    // leaving a standing state here would skip the read. The mutator edits the
    // draft in place — a returned replacement is ignored by the store.
    this.state.update((state) => { state[url] = undefined })
    return this.load(workspaceId)
  }

  /** Forget every generation with the states a replaced connection invalidated. */
  override reset(): void {
    this.generations.clear()
    super.reset()
  }
}

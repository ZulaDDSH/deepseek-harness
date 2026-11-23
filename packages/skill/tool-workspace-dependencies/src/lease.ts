import { FileLockError, withFileLock } from '@deepseek-ai/dsh-atomic-write'
import { WorkspaceDependencyError } from './error.ts'

export async function withInstallLease<T>(root: string, action: () => Promise<T>, waitMs = 300_000): Promise<T> {
  try {
    return await withFileLock(root, action, { waitMs })
  } catch (error) {
    if (error instanceof FileLockError) {
      throw new WorkspaceDependencyError(`primary runtime: another installation holds ${error.lockPath}`, 'WORKSPACE_DEPENDENCY_PREPARATION_FAILED')
    }
    throw error
  }
}

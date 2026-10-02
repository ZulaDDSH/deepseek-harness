/** Read external hook configuration without registering or executing commands. */
import { readFile } from 'node:fs/promises'
import type { HookInventoryHandler, HookInventoryReport } from '@deepseek-ai/dsh-hook-protocol'

/** External application's JSON hook file. */
export interface HookFileSource {
  /** Application owning the hook configuration. */
  readonly dialect: HookInventoryReport['dialect']
  /** Local JSON configuration file path. */
  readonly source: string
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined
}

/** Read configured command metadata from external application settings.
 * @param sources JSON sources selected by the Host configuration.
 * @returns Existing sources, their commands and safe read or parse diagnostics.
 */
export async function readHookFiles(sources: readonly HookFileSource[]): Promise<HookInventoryReport[]> {
  const reports: HookInventoryReport[] = []
  for (const source of sources) {
    try {
      const raw: unknown = JSON.parse(await readFile(source.source, 'utf8'))
      const root = object(raw)
      if (root === undefined) throw new SyntaxError()
      const events = object(root.hooks) ?? root
      if (root.hooks !== undefined && object(root.hooks) === undefined) throw new SyntaxError()
      if (root.hooks === undefined && !Object.values(events).some(groups =>
        Array.isArray(groups) && groups.some(group => Array.isArray(object(group)?.hooks)))) continue
      const handlers: HookInventoryHandler[] = []
      const skipped: string[] = []
      for (const [event, groups] of Object.entries(events)) {
        if (!Array.isArray(groups)) continue
        for (const candidate of groups) {
          const group = object(candidate)
          if (!Array.isArray(group?.hooks)) continue
          for (const candidateHook of group.hooks) {
            const hook = object(candidateHook)
            if (hook === undefined) continue
            if (typeof hook.command === 'string') handlers.push({
              event, command: hook.command, ...typeof group.matcher === 'string' ? { matcher: group.matcher } : {},
            })
            else skipped.push(`${event}: ${typeof hook.type === 'string' ? hook.type : 'missing command'}`)
          }
        }
      }
      reports.push({ ...source, status: 'configured', handlers, skipped })
    } catch (error) {
      if (object(error)?.code === 'ENOENT') continue
      reports.push({ ...source, status: 'failed', handlers: [], skipped: [],
        error: error instanceof SyntaxError ? 'Invalid hook JSON' : 'Cannot read hook configuration' })
    }
  }
  return reports
}

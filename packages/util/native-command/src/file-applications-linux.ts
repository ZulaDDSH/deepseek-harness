/** Linux file associations from GIO, with shared XDG metadata and artwork lookup. */
import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, relative, sep } from 'node:path'
import { desktopApplicationIcon, desktopDataDirectories, desktopEntryFields } from './desktop-entry.ts'
import type { NativeCommandRunner } from './runner.ts'
import type { NativeFileApplication } from './types.ts'

const MAX_DESKTOP_ENTRIES = 50_000
const MAX_TOTAL_ICON_BYTES = 8 * 1024 * 1024

async function desktopIndex(directories: readonly string[], signal: AbortSignal): Promise<Map<string, string>> {
  const index = new Map<string, string>()
  const budget = { remaining: MAX_DESKTOP_ENTRIES }
  const walk = async (root: string, directory: string): Promise<void> => {
    signal.throwIfAborted()
    let entries
    try { entries = await readdir(directory, { withFileTypes: true }) } catch (_error) {
      signal.throwIfAborted()
      return
    }
    budget.remaining -= entries.length
    for (const entry of entries) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) continue
      const id = relative(root, path).split(sep).join('-')
      if (!index.has(id)) index.set(id, path)
    }
    for (const entry of entries) {
      if (budget.remaining < 0) return
      if (entry.isDirectory()) await walk(root, join(directory, entry.name))
    }
  }
  for (const directory of directories) {
    const root = join(directory, 'applications')
    await walk(root, root)
  }
  return index
}

/**
 * Query all registered file handlers from GIO without executing desktop-entry command text.
 * @param path - verified local file path.
 * @param signal - caller cancellation.
 * @param run - native command runner.
 * @param env - XDG and locale settings.
 * @param icons - whether to read application artwork; launch validation needs only identities.
 * @returns registered applications with the desktop's default marked.
 */
export async function linuxFileApplications(
  path: string, signal: AbortSignal, run: NativeCommandRunner, env: NodeJS.ProcessEnv, icons = true,
): Promise<readonly NativeFileApplication[]> {
  const info = await run('gio', ['info', '-a', 'standard::content-type', path], signal, 'hidden')
  const mime = /standard::content-type:\s*(\S+)/.exec(info.stdout)?.[1]
  if (mime === undefined) throw new Error('GIO did not identify the file content type')
  const result = await run('env', ['LC_ALL=C', 'gio', 'mime', mime], signal, 'hidden')
  const preferred = /^Default application.*:\s*(.+\.desktop)\s*$/m.exec(result.stdout)?.[1]
  const ids = [...new Set([...(preferred === undefined ? [] : [preferred]), ...result.stdout.split(/\r?\n/)
    .filter(line => /^\s+.*\.desktop\s*$/.test(line)).map(line => line.trim())])]
  const directories = desktopDataDirectories(env.HOME ?? homedir(), env)
  const locale = (env.LC_ALL ?? env.LC_MESSAGES ?? env.LANG ?? '').replace(/\..*$/, '')
  const applications: NativeFileApplication[] = []
  const index = ids.length === 0 ? new Map<string, string>() : await desktopIndex(directories, signal)
  let iconBudget = MAX_TOTAL_ICON_BYTES
  for (const id of ids) {
    signal.throwIfAborted()
    const entryPath = index.get(id)
    if (entryPath === undefined) continue
    let text
    try { text = await readFile(entryPath, { encoding: 'utf8', signal }) } catch (_error) {
      signal.throwIfAborted()
      continue
    }
    const fields = desktopEntryFields(text)
    const name = fields[`Name[${locale}]`] ?? fields[`Name[${locale.replace(/_.*/, '')}]`] ?? fields.Name
    if (name === undefined || fields.Hidden === 'true') continue
    const icon = !icons || fields.Icon === undefined ? null
      : await desktopApplicationIcon(fields.Icon, directories, { signal, maxBytes: iconBudget })
    if (icon !== null) iconBudget -= icon.bytes.length
    applications.push({ id: entryPath, name, default: id === preferred,
      icon: icon === null ? null : `data:${icon.contentType};base64,${icon.bytes.toString('base64')}` })
  }
  return applications
}

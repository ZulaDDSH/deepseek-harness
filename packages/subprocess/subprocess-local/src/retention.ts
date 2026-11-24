import { lstat, readdir, rmdir, unlink } from 'node:fs/promises'
import type { Stats } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIRECTORY_PATTERN = /^dsh-subprocess-[A-Za-z0-9]{6}$/
const FILE_PATTERN = /^dsh-subprocess-\d+-\d+-[0-9a-f]{12}-[a-z]+\.log$/
const HOUR_MS = 3_600_000
const MIB = 1024 * 1024
const SWEEP_INTERVAL_MS = 60_000

export const MIN_SPILL_AGE_MS = HOUR_MS

export const activeSpills = new Set<string>()

export interface SpillRetention {
  maxAgeMs: number
  maxTotalBytes: number
  minAgeMs: number
}

/**
 * Receives one unexpected failure of the background sweep, which carries on afterwards.
 * @param error - the `node:fs` failure.
 * @param step - the sweep step that failed.
 * @param path - the entry the step acted on.
 */
export type SweepFailureReporter = (error: unknown, step: string, path: string) => void

export interface SweepOptions extends Partial<SpillRetention> {
  root?: string
  keepDirectory?: string
  now?: number
  onFailure?: SweepFailureReporter
}

const VANISHED_CODES: ReadonlySet<string> = new Set(['ENOENT'])
const IN_USE_CODES: ReadonlySet<string> = new Set(['ENOENT', 'EBUSY', 'EPERM'])
const NOT_EMPTY_CODES: ReadonlySet<string> = new Set(['ENOENT', 'ENOTEMPTY', 'EEXIST', 'EBUSY', 'EPERM'])

export function reportSweepFailureToStderr(error: unknown, step: string, path: string): void {
  process.stderr.write(`dsh-subprocess-local: could not ${step} ${path}: ${String(error)}
`)
}

function surface(report: SweepFailureReporter, step: string, path: string, error: unknown, expected: ReadonlySet<string>): void {
  if (expected.has((error as NodeJS.ErrnoException).code ?? '')) return
  report(error, step, path)
}

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const value = Number(raw)
  return Number.isFinite(value) && value >= 0 ? value : fallback
}

export function spillRetentionFromEnv(): SpillRetention {
  return {
    maxAgeMs: envNumber('DSH_SUBPROCESS_SPILL_MAX_AGE_HOURS', 168) * HOUR_MS,
    maxTotalBytes: envNumber('DSH_SUBPROCESS_SPILL_MAX_TOTAL_MB', 1024) * MIB,
    minAgeMs: MIN_SPILL_AGE_MS,
  }
}

interface Candidate { path: string; size: number; mtimeMs: number }

async function lstatIfPresent(path: string, report: SweepFailureReporter): Promise<Stats | undefined> {
  try {
    return await lstat(path)
  } catch (error) {
    surface(report, 'inspect', path, error, VANISHED_CODES)
    return undefined
  }
}

async function ownedDirectory(path: string, report: SweepFailureReporter): Promise<boolean> {
  const info = await lstatIfPresent(path, report)
  if (info === undefined || !info.isDirectory()) return false
  return process.getuid === undefined || info.uid === process.getuid()
}

async function removeFile(path: string, report: SweepFailureReporter): Promise<boolean> {
  try {
    await unlink(path)
    return true
  } catch (error) {
    surface(report, 'remove spill file', path, error, IN_USE_CODES)
    return false
  }
}

async function listDirectory(path: string, report: SweepFailureReporter): Promise<string[] | undefined> {
  try {
    return await readdir(path)
  } catch (error) {
    surface(report, 'list', path, error, VANISHED_CODES)
    return undefined
  }
}

export async function sweepSpillFiles(options: SweepOptions = {}): Promise<{ removed: number; freedBytes: number }> {
  const { onFailure: report = reportSweepFailureToStderr, ...limits } = options
  const policy = { ...spillRetentionFromEnv(), ...limits }
  const root = options.root ?? tmpdir()
  const now = options.now ?? Date.now()
  const directories: string[] = []
  const files: Candidate[] = []
  for (const name of await readdir(root)) {
    if (!DIRECTORY_PATTERN.test(name)) continue
    const directory = join(root, name)
    if (!await ownedDirectory(directory, report)) continue
    directories.push(directory)
    const entries = await listDirectory(directory, report)
    if (entries === undefined) continue
    for (const entry of entries) {
      if (!FILE_PATTERN.test(entry)) continue
      const path = join(directory, entry)
      const info = await lstatIfPresent(path, report)
      if (info === undefined || !info.isFile() || activeSpills.has(path)) continue
      files.push({ path, size: info.size, mtimeMs: info.mtimeMs })
    }
  }
  let removed = 0
  let freedBytes = 0
  const remove = async (file: Candidate): Promise<boolean> => {
    if (!await removeFile(file.path, report)) return false
    removed += 1
    freedBytes += file.size
    return true
  }
  const old = (file: Candidate): boolean => now - file.mtimeMs >= policy.minAgeMs
  const kept: Candidate[] = []
  for (const file of files) {
    if (policy.maxAgeMs > 0 && old(file) && now - file.mtimeMs > policy.maxAgeMs && await remove(file)) continue
    kept.push(file)
  }
  if (policy.maxTotalBytes > 0) {
    let total = kept.reduce((sum, file) => sum + file.size, 0)
    for (const file of kept.sort((a, b) => a.mtimeMs - b.mtimeMs)) {
      if (total <= policy.maxTotalBytes) break
      if (old(file) && await remove(file)) total -= file.size
    }
  }
  for (const directory of directories) {
    if (directory === options.keepDirectory) continue
    const info = await lstatIfPresent(directory, report)
    if (info === undefined || now - info.mtimeMs < policy.minAgeMs) continue
    try {
      await rmdir(directory)
    } catch (error) {
      surface(report, 'remove spill directory', directory, error, NOT_EMPTY_CODES)
    }
  }
  return { removed, freedBytes }
}

let lastSweep = 0
let sweeping = false

export function sweepSpillFilesThrottled(keepDirectory: string | undefined, onFailure: SweepFailureReporter): void {
  const now = Date.now()
  if (sweeping || now - lastSweep < SWEEP_INTERVAL_MS) return
  lastSweep = now
  sweeping = true
  sweepSpillFiles({ ...keepDirectory === undefined ? {} : { keepDirectory }, now, onFailure })
    .catch((error: unknown) => { onFailure(error, 'sweep spill files', tmpdir()) })
    .finally(() => { sweeping = false })
}

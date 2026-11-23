import { createHash } from 'node:crypto'
import { readFile, rm, stat, writeFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { setTimeout as sleep } from 'node:timers/promises'
import { WorkspaceDependencyError } from './error.ts'

const RECORD = /^(\d+) (.+)\n$/
const CLAIM_STALE_MS = 30_000

function record(): string {
  return `${process.pid} ${hostname()}\n`
}

async function readRecord(path: string): Promise<string | undefined> {
  try { return await readFile(path, 'utf8') } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

function holderExited(text: string): boolean {
  const match = RECORD.exec(text)
  if (match === null || match[2] !== hostname()) return false
  try {
    process.kill(Number(match[1]), 0)
    return false
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ESRCH'
  }
}

async function takeOver(lockPath: string): Promise<boolean> {
  const seen = await readRecord(lockPath)
  if (seen === undefined || !holderExited(seen)) return false
  const claim = `${lockPath}.takeover-${createHash('sha256').update(seen).digest('hex').slice(0, 16)}`
  try {
    await writeFile(claim, record(), { mode: 0o600, flag: 'wx' })
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'EEXIST' && code !== 'EPERM') throw error
    const info = await stat(claim).catch(() => undefined)
    if (info !== undefined && Date.now() - info.mtimeMs > CLAIM_STALE_MS) await rm(claim, { force: true })
    return false
  }
  try {
    if (await readRecord(lockPath) !== seen) return false
    await rm(lockPath, { force: true })
    return true
  } catch {
    return false
  } finally {
    await rm(claim, { force: true }).catch(() => undefined)
  }
}

export async function withInstallLease<T>(lockPath: string, action: () => Promise<T>, waitMs = 300_000): Promise<T> {
  const deadline = Date.now() + waitMs
  let delay = 20
  for (;;) {
    try {
      await writeFile(lockPath, record(), { mode: 0o600, flag: 'wx' })
      break
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'EEXIST' && code !== 'EPERM') throw error
      if (await takeOver(lockPath)) continue
    }
    if (Date.now() >= deadline) {
      throw new WorkspaceDependencyError(`primary runtime: another installation holds ${lockPath}`, 'WORKSPACE_DEPENDENCY_PREPARATION_FAILED')
    }
    await sleep(delay)
    delay = Math.min(delay * 2, 200)
  }
  try {
    return await action()
  } finally {
    await rm(lockPath, { force: true })
  }
}

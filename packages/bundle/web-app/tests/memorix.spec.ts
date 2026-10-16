/** The shipped Memorix launch recipe: it resolves the bundled package, and an existing database is copied once before first use. */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BACKUP_SUFFIX, MEMORIX_LAUNCH_SERVICE, apply, backupExistingDatabase, memorixLaunch } from '../src/memorix.ts'

const directories: string[] = []
afterEach(() => {
  vi.unstubAllEnvs()
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true })
})

function dataDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-memorix-launch-'))
  directories.push(directory)
  return directory
}

describe('Memorix launch recipe', () => {
  it('runs the bundled package CLI under the running Node instead of a PATH command', () => {
    const launch = memorixLaunch()
    expect(launch.command).toBe(process.execPath)
    expect(launch.args.slice(1)).toEqual(['serve', '--allow-untracked'])
    expect(existsSync(launch.args[0]!)).toBe(true)
    expect(readFileSync(launch.args[0]!, 'utf8').startsWith('#!/usr/bin/env node')).toBe(true)
  })

  it('provides the recipe as the memorixLaunch service', () => {
    vi.stubEnv('MEMORIX_DATA_DIR', dataDirectory())
    const ctx = new Context()
    apply(ctx)
    expect(MEMORIX_LAUNCH_SERVICE).toBe('memorixLaunch')
    expect(Reflect.get(ctx, MEMORIX_LAUNCH_SERVICE)).toEqual(memorixLaunch())
  })
})

describe('Existing database backup', () => {
  it('copies the database and its sidecars once and never overwrites the copy', () => {
    const directory = dataDirectory()
    writeFileSync(join(directory, 'memorix.db'), 'one')
    writeFileSync(join(directory, 'memorix.db-wal'), 'wal')
    const backup = backupExistingDatabase(directory)
    expect(backup).toBe(join(directory, `memorix.db${BACKUP_SUFFIX}`))
    expect(readFileSync(backup!, 'utf8')).toBe('one')
    expect(readFileSync(`${backup}-wal`, 'utf8')).toBe('wal')
    expect(existsSync(`${backup}-shm`)).toBe(false)
    writeFileSync(join(directory, 'memorix.db'), 'two')
    expect(backupExistingDatabase(directory)).toBeUndefined()
    expect(readFileSync(backup!, 'utf8')).toBe('one')
  })

  it('does nothing when there is no database yet', () => {
    const directory = dataDirectory()
    expect(backupExistingDatabase(directory)).toBeUndefined()
    expect(existsSync(join(directory, `memorix.db${BACKUP_SUFFIX}`))).toBe(false)
  })

  it('follows MEMORIX_DATA_DIR and logs a failed copy without blocking the launch recipe', () => {
    const directory = dataDirectory()
    mkdirSync(join(directory, 'memorix.db'))
    vi.stubEnv('MEMORIX_DATA_DIR', directory)
    const ctx = new Context()
    const warn = vi.spyOn(ctx.logger, 'warn')
    apply(ctx)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('could not back up the existing Memorix database'))
    expect(Reflect.get(ctx, MEMORIX_LAUNCH_SERVICE)).toEqual(memorixLaunch())
  })

  it('logs the kept copy at info level', () => {
    const directory = dataDirectory()
    writeFileSync(join(directory, 'memorix.db'), 'one')
    vi.stubEnv('MEMORIX_DATA_DIR', directory)
    const ctx = new Context()
    const info = vi.spyOn(ctx.logger, 'info')
    apply(ctx)
    expect(info).toHaveBeenCalledWith(expect.stringContaining(BACKUP_SUFFIX))
  })
})

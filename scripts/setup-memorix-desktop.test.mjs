import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { hasMemorixEntry, mergeMemorixPatch } from './setup-memorix-desktop-lib.mjs'
import { BACKUP_SUFFIX, backupExistingDatabase } from '../packages/bundle/web-app/src/memorix-backup.mjs'

const cli = 'C:\\\\Users\\\\dev\\\\.dsh\\\\profiles\\\\desktop\\\\node_modules\\\\memorix\\\\dist\\\\cli\\\\index.js'

test('replaces the default empty patch list', () => {
  const result = mergeMemorixPatch('# user patch\n[]\n', cli)
  assert.match(result, /memory-memorix/u)
  assert.ok(result.includes('MEMORIX_SQLITE_DRIVER: "node"'))
  assert.match(result, /- --mode\n\s*- lite/u)
  assert.doesNotMatch(result, /^\[\]$/mu)
})

test('appends to an existing block patch list', () => {
  const source = '- config:\n    id: existing\n'
  const result = mergeMemorixPatch(source, cli)
  assert.ok(result.startsWith(source))
  assert.match(result, /memory-memorix/u)
})

test('does not duplicate an existing Memorix entry', () => {
  const source = '- insert:\n    - id: memory-memorix\n      name: x\n'
  assert.equal(mergeMemorixPatch(source, cli), source)
  assert.equal(hasMemorixEntry(source), true)
})

test('backs up the shared Memorix database and SQLite sidecars', () => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-memorix-setup-'))
  try {
    writeFileSync(join(directory, 'memorix.db'), 'existing database')
    writeFileSync(join(directory, 'memorix.db-wal'), 'existing wal')
    const backup = backupExistingDatabase(directory)
    assert.equal(backup, join(directory, `memorix.db${BACKUP_SUFFIX}`))
    assert.equal(readFileSync(backup, 'utf8'), 'existing database')
    assert.equal(readFileSync(`${backup}-wal`, 'utf8'), 'existing wal')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('rolls back a partial backup when a SQLite sidecar cannot be copied', () => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-memorix-setup-failure-'))
  const backup = join(directory, `memorix.db${BACKUP_SUFFIX}`)
  try {
    writeFileSync(join(directory, 'memorix.db'), 'existing database')
    mkdirSync(join(directory, 'memorix.db-wal'))
    assert.throws(() => backupExistingDatabase(directory))
    assert.equal(existsSync(backup), false)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

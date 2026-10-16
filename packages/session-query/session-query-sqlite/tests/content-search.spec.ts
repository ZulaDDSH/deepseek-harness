import { afterEach, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { DatabaseSync } from 'node:sqlite'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SqliteSessionQueryEngine, { SESSION_QUERY_SQLITE_APPLICATION_ID } from '@deepseek-ai/dsh-session-query-sqlite'
import { removeIndexFiles } from '../src/schema.ts'

const temporaryDirectories: string[] = []

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true })
  }
})

async function temporaryPath(name: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-session-search-'))
  temporaryDirectories.push(directory)
  return join(directory, name)
}

it('deletes the derived index at start and refuses search when content search is turned off', async () => {
  const path = await temporaryPath('content-off.db')
  const enabled = new Context()
  await enabled.plugin(SessionStore)
  await enabled.plugin(SessionProjectionRegistry)
  const search = await enabled.plugin(SqliteSessionQueryEngine, { path, openAt: 'first-search' })
  await enabled.sessionQuery.searchSessions({ query: 'needle' })
  await expect(stat(path)).resolves.toBeDefined()
  await search.dispose()

  const disabled = new Context()
  await disabled.plugin(SessionStore)
  await disabled.plugin(SessionProjectionRegistry)
  const off = await disabled.plugin(SqliteSessionQueryEngine, { path, openAt: 'startup', contentSearch: false } as never)
  await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' })
  await expect(disabled.sessionQuery.searchSessions({ query: 'needle' }))
    .rejects.toMatchObject({ code: 'SESSION_QUERY_SEARCH_DISABLED' })
  await off.dispose()
})

it('removes only the index and its sidecars, leaving neighbouring files alone', async () => {
  const path = await temporaryPath('index.db')
  const neighbours = ['index.db.bak', 'index.dbx', 'other-wal', 'notes.txt'].map(name => join(dirname(path), name))
  const sidecars = ['-wal', '-shm', '-journal'].map(suffix => `${path}${suffix}`)
  const db = new DatabaseSync(path)
  db.exec(`PRAGMA application_id = ${SESSION_QUERY_SQLITE_APPLICATION_ID}`)
  db.close()
  for (const file of [...neighbours, ...sidecars]) await writeFile(file, 'keep')

  await expect(removeIndexFiles(path)).resolves.toBe(true)

  for (const file of [path, ...sidecars]) await expect(stat(file)).rejects.toMatchObject({ code: 'ENOENT' })
  for (const file of neighbours) await expect(stat(file)).resolves.toBeDefined()
  await expect(removeIndexFiles(path)).resolves.toBe(true)
})

it('leaves a file that is not this application index in place', async () => {
  const text = await temporaryPath('notes.db')
  await writeFile(text, 'not a database, just notes')
  await writeFile(`${text}-wal`, 'keep')
  const foreign = await temporaryPath('foreign.db')
  const db = new DatabaseSync(foreign)
  db.exec('PRAGMA application_id = 12345')
  db.close()
  const directory = await temporaryPath('dir')
  await mkdir(directory)

  for (const path of [text, foreign, directory]) await expect(removeIndexFiles(path)).resolves.toBe(false)

  await expect(readFile(text, 'utf8')).resolves.toBe('not a database, just notes')
  await expect(readFile(`${text}-wal`, 'utf8')).resolves.toBe('keep')
  await expect(stat(foreign)).resolves.toBeDefined()
  await expect(stat(directory)).resolves.toBeDefined()
})

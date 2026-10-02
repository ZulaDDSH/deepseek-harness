/** External configuration is displayed without applying an execution bridge. */
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { readHookFiles } from '../src/hook-files.ts'

it('reads all external command events, refreshes files and reports safe failures', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hook-inventory-'))
  onTestFinished(async () => { await rm(root, { recursive: true, force: true }) })
  const source = { dialect: 'codex' as const, source: join(root, 'hooks.json') }
  const marker = join(root, 'should-not-exist')
  await writeFile(source.source, JSON.stringify({ hooks: {
    PreToolUse: [{ matcher: 'Write', hooks: [{ command: `write ${marker}` }] }],
    FutureEvent: [{ hooks: [{ type: 'command', command: 'future', async: true }, { type: 'prompt' }] }],
  } }))
  expect(await readHookFiles([source, { ...source, source: join(root, 'absent.json') }])).toEqual([{
    ...source, status: 'configured', handlers: [
      { event: 'PreToolUse', matcher: 'Write', command: `write ${marker}` },
      { event: 'FutureEvent', command: 'future' },
    ], skipped: ['FutureEvent: prompt'],
  }])
  await writeFile(source.source, '{"secret":"do-not-display"')
  expect(await readHookFiles([source])).toEqual([{ ...source, status: 'failed', handlers: [], skipped: [], error: 'Invalid hook JSON' }])
  const claude = { dialect: 'claude-code' as const, source: join(root, 'settings.json') }
  await writeFile(claude.source, JSON.stringify({ model: 'no-hook-settings' }))
  expect(await readHookFiles([claude])).toEqual([])
  await writeFile(claude.source, JSON.stringify({ hooks: { SubagentStart: [{ hooks: [{ command: 'claude' }] }] } }))
  expect((await readHookFiles([claude]))[0]?.handlers).toEqual([{ event: 'SubagentStart', command: 'claude' }])
  const { existsSync } = await import('node:fs')
  expect(existsSync(marker)).toBe(false)
})

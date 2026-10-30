/** External configuration is displayed without applying an execution bridge. */
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { hookKey } from '../src/hook-key.ts'
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
      { event: 'PreToolUse', matcher: 'Write', command: `write ${marker}`, key: hookKey('PreToolUse', 'Write', `write ${marker}`) },
      { event: 'FutureEvent', command: 'future', key: hookKey('FutureEvent', undefined, 'future') },
    ], skipped: ['FutureEvent: prompt'],
  }])
  await writeFile(source.source, '{"secret":"do-not-display"')
  expect(await readHookFiles([source])).toEqual([{ ...source, status: 'failed', handlers: [], skipped: [], error: 'Invalid hook JSON' }])
  const claude = { dialect: 'claude-code' as const, source: join(root, 'settings.json') }
  await writeFile(claude.source, JSON.stringify({ model: 'no-hook-settings' }))
  expect(await readHookFiles([claude])).toEqual([])
  await writeFile(claude.source, JSON.stringify({ hooks: { SubagentStart: [{ hooks: [{ command: 'claude' }] }] } }))
  expect((await readHookFiles([claude]))[0]?.handlers).toEqual([{ event: 'SubagentStart', command: 'claude', key: hookKey('SubagentStart', undefined, 'claude') }])
  const { existsSync } = await import('node:fs')
  expect(existsSync(marker)).toBe(false)
})

it('reads a top-level event map and skips malformed groups and handlers', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hook-inventory-'))
  onTestFinished(async () => { await rm(root, { recursive: true, force: true }) })
  const source = { dialect: 'claude-code' as const, source: join(root, 'settings.json') }
  await writeFile(source.source, JSON.stringify({
    Stop: [{ hooks: [{ command: 'stop' }, null, {}] }, 'bare', { matcher: 'x' }],
    notes: 'not an event',
  }))
  expect(await readHookFiles([source])).toEqual([{
    ...source, status: 'configured', skipped: ['Stop: missing command'],
    handlers: [{ event: 'Stop', command: 'stop', key: hookKey('Stop', undefined, 'stop') }],
  }])
})

it('reports unusable roots and unreadable files without leaking their content', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hook-inventory-'))
  onTestFinished(async () => { await rm(root, { recursive: true, force: true }) })
  const source = { dialect: 'codex' as const, source: join(root, 'hooks.json') }
  const failed = (error: string) => [{ ...source, status: 'failed', handlers: [], skipped: [], error }]
  await writeFile(source.source, '["secret"]')
  expect(await readHookFiles([source])).toEqual(failed('Invalid hook JSON'))
  await writeFile(source.source, '{"hooks":"secret"}')
  expect(await readHookFiles([source])).toEqual(failed('Invalid hook JSON'))
  expect(await readHookFiles([{ ...source, source: root }])).toEqual([{ ...failed('Cannot read hook configuration')[0], source: root }])
})

it('lists claude-code prompt hooks as handlers on events the bridge runs and skips the rest', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hook-inventory-'))
  onTestFinished(async () => { await rm(root, { recursive: true, force: true }) })
  const claude = { dialect: 'claude-code' as const, source: join(root, 'settings.json') }
  const codex = { dialect: 'codex' as const, source: join(root, 'hooks.json') }
  await writeFile(claude.source, JSON.stringify({ hooks: {
    PreToolUse: [{ matcher: 'Write', hooks: [{ type: 'prompt', prompt: 'is $ARGUMENTS safe?' }, { type: 'prompt' }] }],
    SessionStart: [{ hooks: [{ type: 'prompt', prompt: 'hello' }] }],
    Stop: [{ hooks: [{ type: 'agent', prompt: 'verify' }] }],
  } }))
  await writeFile(codex.source, JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'prompt', prompt: 'codex prompt' }] }] } }))
  expect(await readHookFiles([claude, codex])).toEqual([
    {
      ...claude, status: 'configured', handlers: [
        { event: 'PreToolUse', matcher: 'Write', command: 'is $ARGUMENTS safe?', key: hookKey('PreToolUse', 'Write', 'is $ARGUMENTS safe?') },
      ], skipped: ['PreToolUse: prompt', 'SessionStart: prompt', 'Stop: agent'],
    },
    { ...codex, status: 'configured', handlers: [], skipped: ['Stop: prompt'] },
  ])
})

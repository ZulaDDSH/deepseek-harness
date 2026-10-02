import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { expect, it, onTestFinished } from 'vitest'
import * as Codex from '../packages/hooks/hooks-codex/src/index.ts'
import * as Claude from '../packages/hooks/hooks-claude-code/src/index.ts'
import type { HookInventoryReport } from '../packages/hooks/hook-protocol/src/inventory.ts'

it.each([Codex, Claude])('collects loaded hooks through the Loader without executing commands: $name', async (bridge) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-hook-inventory-'))
  const ctx = new Context()
  onTestFinished(async () => {
    await ctx.fiber.dispose()
    rmSync(root, { recursive: true, force: true })
  })
  ctx.provide('shell', {} as never)
  ctx.provide('sessionProjections', {} as never)
  await ctx.plugin(Loader)
  ctx.loader.builtins.hooks = bridge
  const source = join(root, 'hooks.json')
  writeFileSync(source, JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [
    { type: 'command', command: 'check-policy' }, { type: 'prompt', prompt: 'unsupported' },
  ] }] } }))
  await ctx.loader.create({ name: 'cordis:hooks', config: { configPath: source } })
  const collect = (): HookInventoryReport[] => {
    const reports: HookInventoryReport[] = []
    ctx.emit('hooks/inventory', reports)
    return reports
  }
  expect(collect()[0]).toMatchObject({ source, status: 'loaded',
    handlers: [{ event: 'PreToolUse', matcher: 'Bash', command: 'check-policy' }],
  })
  expect(collect()[0]?.skipped).toHaveLength(1)
  writeFileSync(source, '{}')
  expect(collect()[0]?.handlers[0]?.command).toBe('check-policy')
  const failedId = await ctx.loader.create({ name: 'cordis:hooks', config: { configPath: join(root, 'missing.json') } })
  expect(collect()).toHaveLength(2)
  expect(collect()[1]).toMatchObject({ status: 'failed', handlers: [], error: expect.stringContaining('ENOENT') })
  await Array.from(ctx.loader.entries()).find(entry => entry.id === failedId)!.fiber!.dispose()
  expect(collect()).toHaveLength(1)
  await ctx.fiber.dispose()
  expect(collect()).toEqual([])
})

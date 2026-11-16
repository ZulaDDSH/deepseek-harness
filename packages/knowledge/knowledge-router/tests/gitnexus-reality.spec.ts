/**
 * Real-GitNexus tier: indexes a throwaway repository, connects the real
 * `gitnexus` MCP server through the real `dsh-mcp-client`, and proves the
 * router surfaces the index freshness GitNexus reports once its index falls
 * behind HEAD.
 *
 * Self-skips when no `gitnexus` executable is available; set
 * `DSH_GITNEXUS_COMMAND` to point at a specific install.
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as mcpClient from '@deepseek-ai/dsh-mcp-client'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import KnowledgeRouter from '../src/index.ts'

const command = process.env.DSH_GITNEXUS_COMMAND ?? 'gitnexus'
/*
 * A Windows install is a `.cmd` shim, which needs a shell to launch. A shell
 * reports its own non-zero status for a missing command, so availability is
 * decided by a version string on stdout rather than by the exit status.
 */
const probe = spawnSync(command, ['--version'], { encoding: 'utf8', windowsHide: true, shell: true })
const available = /\d+\.\d+\.\d+/.test(probe.stdout ?? '')

const SESSION_TS = [
  'export function closeSession(id: string): void {',
  '  teardown(id)',
  '}',
  '',
  'export function teardown(id: string): void {',
  '  void id',
  '}',
  '',
  'export function openSession(id: string): void {',
  '  closeSession(id)',
  '}',
  '',
].join('\n')

const MAIN_TS = [
  "import { openSession } from './session.ts'",
  '',
  'export function run(): void {',
  "  openSession('s1')",
  '}',
  '',
].join('\n')

/** Run one git command in the fixture, silently. */
function git(directory: string, args: readonly string[]): void {
  execFileSync('git', [...args], { cwd: directory, stdio: 'ignore' })
}

let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
})

describe.skipIf(!available)('GitNexus over the real MCP client', () => {
  it('surfaces the index as stale once it falls behind the indexed revision', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-gitnexus-'))
    git(directory, ['init'])
    git(directory, ['config', 'user.email', 'verify@example.com'])
    git(directory, ['config', 'user.name', 'verify'])
    await writeFile(join(directory, 'session.ts'), SESSION_TS)
    await writeFile(join(directory, 'main.ts'), MAIN_TS)
    git(directory, ['add', '-A'])
    git(directory, ['commit', '-m', 'fixture'])

    execFileSync(command, ['analyze'], { cwd: directory, stdio: 'ignore', shell: true })

    // Commit past the indexed revision so the index is behind HEAD.
    await writeFile(join(directory, 'session.ts'), `${SESSION_TS}\nexport function extra(): void {}\n`)
    git(directory, ['add', '-A'])
    git(directory, ['commit', '-m', 'change after indexing'])

    const ctx = new Context()
    context = ctx
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(mcpClient, {
      transport: 'stdio',
      serverName: 'gitnexus',
      command,
      args: ['mcp'],
      cwd: directory,
      failOnStartupError: true,
      reconnect: { enabled: false },
    })
    await ctx.plugin(KnowledgeRouter, { mode: 'manual', gitnexus: { enabled: true } })

    expect(ctx.knowledge.status()[0]).toMatchObject({ provider: 'gitnexus', connected: true })

    const packet = await ctx.knowledge.retrieve('What calls closeSession?', {
      signal: new AbortController().signal,
    })
    expect(packet.providers).toEqual(['gitnexus'])
    const item = packet.items[0]
    expect(item?.freshness.kind).toBe('stale')
    if (item?.freshness.kind !== 'stale') throw new Error('expected a stale freshness')
    expect(item.freshness.detail).toMatch(/commit behind HEAD/)
  }, 180_000)
})

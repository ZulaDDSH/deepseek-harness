import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import type { Entry } from '@deepseek-ai/cordis-plugin-loader'
import { expect, it, onTestFinished, vi } from 'vitest'
import { boot, initProfile, loadProfileDirectory, readProfileManifest, readProfilePatches, type ProfileContext } from '@deepseek-ai/dsh-app-boot'
import { parse } from 'yaml'
import PluginManager, { type McpServerCandidate, type PluginInfo } from '../src/index.ts'
import type * as McpServers from '../src/mcp-servers.ts'

const discovered = vi.hoisted(() => ({ rows: [] as Array<Omit<McpServerCandidate, 'configured'>> }))
vi.mock('../src/mcp-servers.ts', async importOriginal => ({
  ...await importOriginal<typeof McpServers>(),
  discoverMcpServers: () => Promise.resolve(discovered.rows),
}))

async function fixture() {
  const temporaryHome = mkdtempSync(join(tmpdir(), 'plugin-manager-mcp-'))
  let owner: Context | undefined
  onTestFinished(async () => { await owner?.fiber.dispose(); rmSync(temporaryHome, { recursive: true, force: true }) })
  const home = await realpath(temporaryHome)
  const dir = join(home, 'profiles', 'test')
  const anchor = join(home, 'package.json')
  writeFileSync(anchor, '{"name":"installation","dependencies":{}}\n')
  initProfile(dir, ['core'])
  const path = join(dir, 'node_modules', 'core')
  mkdirSync(path, { recursive: true })
  writeFileSync(join(path, 'package.json'), JSON.stringify({ name: 'core', version: '1.0.0', dsh: { bundle: { patch: './cordis.patch.yml' } } }))
  writeFileSync(join(path, 'cordis.patch.yml'), JSON.stringify([{ insert: [{ id: 'manager', name: 'cordis:manager' }] }]))
  writeFileSync(join(dir, 'package.json'), JSON.stringify(readProfileManifest('test', dir)))
  writeFileSync(join(dir, 'cordis.yml'), '[]\n')
  const profile: ProfileContext = {
    name: 'test', startedBundles: loadProfileDirectory('test', dir, anchor).layers.map(layer => layer.packageName),
    dir, patchPath: join(dir, 'cordis.patch.yml'), installAnchor: anchor, cwd: home, home, overlays: [], telemetryDisabledEnv: undefined,
  }
  const ctx = await boot('test', join(dir, 'cordis.yml'), readProfilePatches('test', profile), (ctx) => {
    owner = ctx
    ctx.provide('appReady', { onReady: (listener: () => void) => { listener(); return () => {} } })
    ctx.provide('profileContext', profile)
    ctx.loader.builtins.manager = PluginManager
  })
  return { ctx, manager: ctx.pluginManager, profile }
}

function row(entryId: string, patchId?: string): PluginInfo {
  const base = { entryId: entryId as PluginInfo['entryId'], moduleName: '@deepseek-ai/dsh-mcp-client', enabled: true, fiberPhase: 'active' as const }
  return patchId === undefined ? { ...base, readOnlyReason: 'unaddressable' } : { ...base, patchId }
}

function entry(id: string, config: Record<string, unknown>): Entry {
  return { id, options: { config } } as Entry
}

it('lists, discovers, adds and removes MCP servers through the profile patch', async () => {
  const { ctx, manager, profile } = await fixture()
  const entries = [
    entry('include:mcp-a', { transport: 'stdio', serverName: 'a', command: 'node', args: ['a.js', 1] }),
    entry('include:mcp-b', { transport: 'streamable-http', serverName: 'b', url: 'https://b' }),
    entry('include:mcp-c', { transport: 'streamable-http' }),
    entry('include:mcp-d', { command: 'run', args: 'x' }),
  ]
  const loaderEntries = vi.spyOn(ctx.loader, 'entries').mockImplementation(function* () { yield* entries })
  const plugins = vi.spyOn(manager, 'listPlugins').mockResolvedValue([
    row('include:mcp-a', 'mcp-a'), row('include:mcp-b'), row('include:mcp-c', 'mcp-c'), row('include:mcp-d', 'mcp-d'), row('include:mcp-e', 'mcp-e'),
    { ...row('include:other', 'other'), moduleName: '@acme/other' },
  ])
  expect(await manager.listMcpServers()).toEqual([
    { entryId: 'include:mcp-a', patchId: 'mcp-a', serverName: 'a', transport: 'stdio', target: 'node a.js', enabled: true, phase: 'active', removable: true },
    { entryId: 'include:mcp-b', serverName: 'b', transport: 'streamable-http', target: 'https://b', enabled: true, phase: 'active', removable: false },
    { entryId: 'include:mcp-c', patchId: 'mcp-c', serverName: 'include:mcp-c', transport: 'streamable-http', target: '', enabled: true, phase: 'active', removable: true },
    { entryId: 'include:mcp-d', patchId: 'mcp-d', serverName: 'include:mcp-d', transport: 'stdio', target: 'run', enabled: true, phase: 'active', removable: true },
    { entryId: 'include:mcp-e', patchId: 'mcp-e', serverName: 'include:mcp-e', transport: 'stdio', target: '', enabled: true, phase: 'active', removable: true },
  ])
  discovered.rows = [
    { source: 'codex', config: { transport: 'stdio', serverName: 'a', command: 'node', args: [], env: {} } },
    { source: 'claude-code', config: { transport: 'stdio', serverName: 'new', command: 'node', args: [], env: {} } },
  ]
  expect((await manager.discoverMcpServers()).map(candidate => [candidate.config.serverName, candidate.configured])).toEqual([['a', true], ['new', false]])

  expect(await manager.addMcpServer({ transport: 'stdio', serverName: 'a', command: 'node', args: [], env: {} }))
    .toMatchObject({ application: 'failed', changed: false, error: { code: 'ambiguous-install' } })
  expect(await manager.addMcpServer({ transport: 'stdio', serverName: 'new tool', command: 'node', args: [], env: {} }))
    .toMatchObject({ changed: true, stage: 'install', target: 'mcp-new-tool' })
  expect(parse(readFileSync(profile.patchPath, 'utf8'))).toContainEqual({ insert: [{
    id: 'mcp-new-tool', name: '@deepseek-ai/dsh-mcp-client',
    config: { transport: 'stdio', serverName: 'new-tool', command: 'node', args: [], env: {} },
  }] })

  const id = (value: string): PluginInfo['entryId'] => value as PluginInfo['entryId']
  expect(await manager.removeMcpServer(id('include:missing'))).toMatchObject({ application: 'failed', error: { code: 'unknown-plugin' } })
  expect(await manager.removeMcpServer(id('include:mcp-b'))).toMatchObject({ application: 'failed', error: { code: 'not-removable' } })
  expect(await manager.removeMcpServer(id('include:mcp-a'))).toMatchObject({ application: 'failed', error: { code: 'not-removable' } })
  plugins.mockResolvedValue([row('include:mcp-new-tool', 'mcp-new-tool')])
  expect(await manager.removeMcpServer(id('include:mcp-new-tool'))).toMatchObject({ changed: true, stage: 'remove', target: 'include:mcp-new-tool' })
  expect(readFileSync(profile.patchPath, 'utf8')).not.toContain('mcp-new-tool')
  loaderEntries.mockRestore()
})

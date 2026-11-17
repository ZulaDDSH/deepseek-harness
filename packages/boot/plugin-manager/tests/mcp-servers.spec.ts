import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished, vi } from 'vitest'
import { parse } from 'yaml'
import { discoverMcpServers, insertMcpServer, mcpServerName, normalizeMcpServer, removeMcpServer } from '../src/mcp-servers.ts'

it('discovers Claude Desktop, Claude Code and Codex servers and edits the profile patch', async () => {
  const home = mkdtempSync(join(tmpdir(), 'mcp-discover-'))
  onTestFinished(() => { rmSync(home, { recursive: true, force: true }) })
  const appData = join(home, 'AppData')
  mkdirSync(join(appData, 'Claude'), { recursive: true })
  mkdirSync(join(home, '.codex'))
  writeFileSync(join(appData, 'Claude', 'claude_desktop_config.json'), JSON.stringify({ mcpServers: { obs: { command: 'npx', args: ['obs-mcp'], env: { PASS: 'x' } } } }))
  writeFileSync(join(home, '.claude.json'), JSON.stringify({
    mcpServers: { obs: { command: 'dup' }, web: { type: 'http', url: 'https://example.test/mcp', headers: { A: 'b' } }, old: { type: 'sse', url: 'https://x' } },
    projects: { p: { mcpServers: { 'my server!': { command: 'node', args: ['a.js'] } } } },
  }))
  writeFileSync(join(home, '.codex', 'config.toml'), "[mcp_servers.re]\ncommand = 'node'\nargs = ['re.js']\n[mcp_servers.re.env]\nK = 'v'\n")
  expect(await discoverMcpServers(home, appData)).toEqual([
    { source: 'claude-desktop', config: { transport: 'stdio', serverName: 'obs', command: 'npx', args: ['obs-mcp'], env: { PASS: 'x' } } },
    { source: 'claude-code', config: { transport: 'streamable-http', serverName: 'web', url: 'https://example.test/mcp', headers: { A: 'b' } } },
    { source: 'claude-code', config: { transport: 'stdio', serverName: 'my-server-', command: 'node', args: ['a.js'], env: {} } },
    { source: 'codex', config: { transport: 'stdio', serverName: 're', command: 'node', args: ['re.js'], env: { K: 'v' } } },
  ])
  expect(normalizeMcpServer('x', 'bad')).toBeUndefined()

  const patch = join(home, 'cordis.patch.yml')
  writeFileSync(patch, '- id: other\n  config: {}\n')
  const config = normalizeMcpServer('re', { command: 'node' })!
  await insertMcpServer(patch, 'mcp-re', config)
  expect(parse(readFileSync(patch, 'utf8'))).toEqual([
    { id: 'other', config: {} },
    { insert: [{ id: 'mcp-re', name: '@deepseek-ai/dsh-mcp-client', config: { transport: 'stdio', serverName: 're', command: 'node', args: [], env: {} } }] },
  ])
  expect(await removeMcpServer(patch, 'mcp-re')).toBe(true)
  expect(parse(readFileSync(patch, 'utf8'))).toEqual([{ id: 'other', config: {} }])
  expect(await removeMcpServer(patch, 'mcp-re')).toBe(false)

  writeFileSync(patch, '- id: other\n  config: {}\n- id: mcp-re\n  disabled: true\n')
  expect(await removeMcpServer(patch, 'mcp-re')).toBe(true)
  expect(parse(readFileSync(patch, 'utf8'))).toEqual([{ id: 'other', config: {} }])
})

it('tolerates missing sources and rejects unusable profile patches', async () => {
  const home = mkdtempSync(join(tmpdir(), 'mcp-empty-'))
  onTestFinished(() => { rmSync(home, { recursive: true, force: true }) })
  expect(await discoverMcpServers(home, join(home, 'AppData'))).toEqual([])
  writeFileSync(join(home, '.claude.json'), '{ not json')
  mkdirSync(join(home, '.codex'))
  writeFileSync(join(home, '.codex', 'config.toml'), '[mcp_servers.x\n')
  expect(await discoverMcpServers(home, join(home, 'AppData'))).toEqual([])
  expect(normalizeMcpServer('a', { command: '', url: 'https://x', type: 'sse' })).toBeUndefined()
  expect(normalizeMcpServer('a', { command: 'node', args: 'one' })).toEqual({ transport: 'stdio', serverName: 'a', command: 'node', args: [], env: {} })
  expect(normalizeMcpServer('!!!', { url: 'https://x' })).toEqual({ transport: 'streamable-http', serverName: '---', url: 'https://x', headers: {} })

  const patch = join(home, 'missing.yml')
  await insertMcpServer(patch, 'mcp-a', { transport: 'stdio', serverName: 'a', command: 'node', args: [], env: {} })
  expect(parse(readFileSync(patch, 'utf8'))).toHaveLength(1)
  await expect(insertMcpServer(home, 'mcp-a', { transport: 'stdio', serverName: 'a', command: 'node', args: [], env: {} })).rejects.toThrow()
  writeFileSync(patch, ['- plain', '- insert:', '    - keep', '    - id: mcp-a', '    - id: mcp-b', ''].join('\n'))
  expect(await removeMcpServer(patch, 'mcp-a')).toBe(true)
  expect(parse(readFileSync(patch, 'utf8'))).toEqual(['plain', { insert: ['keep', { id: 'mcp-b' }] }])
  expect(await removeMcpServer(patch, 'mcp-missing')).toBe(false)
  writeFileSync(patch, ['- id: tool', '  config:', '    command: !!js process.execPath', '- id: mcp-b', ''].join('\n'))
  expect(await removeMcpServer(patch, 'mcp-b')).toBe(true)
  expect(readFileSync(patch, 'utf8')).toContain('!!js process.execPath')
  expect(mcpServerName('')).toBe('server')
  vi.stubEnv('HOME', home)
  vi.stubEnv('USERPROFILE', home)
  vi.stubEnv('APPDATA', join(home, 'Roaming'))
  expect(await discoverMcpServers()).toEqual([])
  vi.stubEnv('APPDATA', undefined)
  expect(await discoverMcpServers(home)).toEqual([])
  vi.unstubAllEnvs()
  writeFileSync(patch, 'a: [')
  await expect(removeMcpServer(patch, 'mcp-a')).rejects.toThrow()
  writeFileSync(patch, 'a: 1\n')
  await expect(removeMcpServer(patch, 'mcp-a')).rejects.toThrow('Profile patch must be a YAML sequence')
})

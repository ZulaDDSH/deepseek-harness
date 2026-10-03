import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { parse } from 'yaml'
import { discoverMcpServers, insertMcpServer, normalizeMcpServer, removeMcpServer } from '../src/mcp-servers.ts'

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
})

import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parse as parseToml } from 'smol-toml'
import { isMap, isSeq, parseDocument } from 'yaml'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'

/** Plugin package that hosts one MCP server per entry. */
export const MCP_CLIENT_MODULE = '@deepseek-ai/dsh-mcp-client'

/** MCP server connection stored as an MCP client entry's config. */
export type McpServerConfig =
  | { readonly transport: 'stdio'; readonly serverName: string; readonly command: string; readonly args: readonly string[]; readonly env: Readonly<Record<string, string>> }
  | { readonly transport: 'streamable-http'; readonly serverName: string; readonly url: string; readonly headers: Readonly<Record<string, string>> }

/** Application whose configuration supplied an importable server. */
export type McpServerSource = 'claude-desktop' | 'claude-code' | 'codex'

/** Server found in another application's configuration. */
export interface McpServerCandidate {
  readonly source: McpServerSource
  readonly config: McpServerConfig
  readonly configured: boolean
}

/** Live connection of one MCP server, as its client reports it. */
export interface McpServerConnection {
  readonly state: 'connecting' | 'connected' | 'auth-required' | 'failed'
  readonly toolCount: number
  readonly error?: string
  readonly authKey?: string
}

/** Configured MCP client entry as listed in Settings. */
export interface McpServerRow {
  readonly entryId: string
  readonly patchId?: string
  readonly serverName: string
  readonly transport: string
  readonly target: string
  readonly enabled: boolean
  readonly phase: string | null
  readonly removable: boolean
  readonly connection?: McpServerConnection
}

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function strings(value: unknown): Record<string, string> {
  return Object.fromEntries(Object.entries(object(value) ?? {}).filter((pair): pair is [string, string] => typeof pair[1] === 'string'))
}

/** Coerce a name into the MCP client's server-name alphabet.
 * @param name Name from another application's configuration.
 * @returns A non-empty name of at most 32 `[A-Za-z0-9_-]` characters.
 */
export function mcpServerName(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 32) || 'server'
}

/** Convert one foreign server definition into an MCP client config.
 * @param name Server name from the source configuration.
 * @param raw Server definition with `command` or `url`.
 * @returns A stdio or streamable HTTP config, or undefined for unsupported definitions.
 */
export function normalizeMcpServer(name: string, raw: unknown): McpServerConfig | undefined {
  const server = object(raw)
  if (server === undefined) return undefined
  const serverName = mcpServerName(name)
  if (typeof server.command === 'string' && server.command.length > 0) {
    const args = Array.isArray(server.args) ? server.args.filter((arg): arg is string => typeof arg === 'string') : []
    return { transport: 'stdio', serverName, command: server.command, args, env: strings(server.env) }
  }
  const type = typeof server.type === 'string' ? server.type : undefined
  if (typeof server.url === 'string' && type !== 'sse') {
    return { transport: 'streamable-http', serverName, url: server.url, headers: { ...strings(server.headers), ...strings(server.http_headers) } }
  }
  return undefined
}

async function readJson(path: string): Promise<unknown> {
  try {
    const value: unknown = JSON.parse(await readFile(path, 'utf8'))
    return value
  }
  catch { return undefined }
}

async function readToml(path: string): Promise<unknown> {
  try { return parseToml(await readFile(path, 'utf8')) }
  catch { return undefined }
}

/** Read MCP servers configured for Claude Desktop, Claude Code and Codex.
 * @param home User home directory.
 * @param appData Windows roaming application data directory.
 * @returns Importable servers, first occurrence of each name only.
 */
export async function discoverMcpServers(home = homedir(), appData = process.env.APPDATA ?? join(home, 'AppData', 'Roaming')): Promise<Array<Omit<McpServerCandidate, 'configured'>>> {
  const found: Array<Omit<McpServerCandidate, 'configured'>> = []
  const add = (source: McpServerSource, servers: unknown): void => {
    for (const [name, raw] of Object.entries(object(servers) ?? {})) {
      const config = normalizeMcpServer(name, raw)
      if (config !== undefined && !found.some(row => row.config.serverName === config.serverName)) found.push({ source, config })
    }
  }
  add('claude-desktop', object(await readJson(join(appData, 'Claude', 'claude_desktop_config.json')))?.mcpServers)
  const claudeCode = object(await readJson(join(home, '.claude.json')))
  add('claude-code', claudeCode?.mcpServers)
  for (const project of Object.values(object(claudeCode?.projects) ?? {})) add('claude-code', object(project)?.mcpServers)
  add('codex', object(await readToml(join(home, '.codex', 'config.toml')))?.mcp_servers)
  return found
}

function idOf(node: { toJSON(): unknown }): unknown {
  return object(node.toJSON())?.id
}

async function readPatch(filename: string) {
  let text: string
  try { text = await readFile(filename, 'utf8') }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    text = '[]\n'
  }
  const document = parseDocument(text, { customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: (value: string) => value }] })
  if (document.errors[0] !== undefined) throw document.errors[0]
  const rows = document.contents
  if (!isSeq(rows)) throw new Error('Profile patch must be a YAML sequence')
  return { document, rows }
}

/** Append an MCP client entry to the profile patch.
 * @param filename Profile patch path.
 * @param id Entry id.
 * @param config Server connection.
 */
export async function insertMcpServer(filename: string, id: string, config: McpServerConfig): Promise<void> {
  const { document } = await readPatch(filename)
  document.add(document.createNode({ insert: [{ id, name: MCP_CLIENT_MODULE, config }] }))
  await writeFileAtomic(filename, String(document), { mode: 0o600 })
}

/** Remove an MCP client entry and its override rows from the profile patch.
 * @param filename Profile patch path.
 * @param id Entry id.
 * @returns Whether any row was removed.
 */
export async function removeMcpServer(filename: string, id: string): Promise<boolean> {
  const { document, rows } = await readPatch(filename)
  let removed = false
  for (let index = rows.items.length - 1; index >= 0; index--) {
    const row = rows.items[index]
    if (!isMap(row)) continue
    const insert = row.get('insert')
    if (isSeq(insert)) {
      const before = insert.items.length
      insert.items = insert.items.filter(item => !(isMap(item) && idOf(item) === id))
      if (insert.items.length !== before) removed = true
      if (insert.items.length === 0) rows.items.splice(index, 1)
    } else if (idOf(row) === id) {
      rows.items.splice(index, 1)
      removed = true
    }
  }
  if (removed) await writeFileAtomic(filename, String(document), { mode: 0o600 })
  return removed
}

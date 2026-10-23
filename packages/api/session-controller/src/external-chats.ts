import { brandString } from '@deepseek-ai/dsh-brand'
import { createHash } from 'node:crypto'
import { open, readdir, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { ExternalChat, ExternalChatKey, ExternalChatSource } from './types.ts'

/** Supported text history and source project metadata. */
export interface ExternalTranscript {
  readonly cwd?: string
  readonly title: string
  readonly messages: readonly { role: 'user' | 'assistant'; text: string }[]
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined
}

/**
 * Extract supported user and assistant text from vendor JSONL records.
 * @param source - vendor record format.
 * @param text - complete transcript JSONL; malformed records reject the file.
 * @returns supported messages with a title and optional project directory.
 */
export function parseExternalTranscript(source: ExternalChatSource, text: string): ExternalTranscript {
  const messages: { role: 'user' | 'assistant'; text: string }[] = []
  const seen = new Set<string>()
  let cwd: string | undefined
  let title: string | undefined
  const rows = text.split('\n').flatMap((line, index) => {
    if (!line.trim()) return []
    let value: unknown
    try { value = JSON.parse(line) } catch { throw new Error(`Invalid JSON at line ${index + 1}`) }
    const row = record(value)
    if (row === undefined) throw new Error(`Invalid record at line ${index + 1}`)
    return [row]
  })
  let active: Set<string> | undefined
  if (source === 'claude') {
    const nodes = new Map(rows.flatMap(row => typeof row['uuid'] === 'string' ? [[row['uuid'], row] as const] : []))
    const leaf = rows.findLast(row => (row['type'] === 'user' || row['type'] === 'assistant')
      && row['isSidechain'] !== true && typeof row['uuid'] === 'string' && 'parentUuid' in row)
    if (leaf !== undefined) {
      active = new Set<string>()
      let node: Record<string, unknown> | undefined = leaf
      while (node !== undefined && typeof node['uuid'] === 'string') {
        const id = node['uuid']
        if (active.has(id)) throw new Error('Transcript contains a parent cycle')
        active.add(id)
        node = typeof node['parentUuid'] === 'string' ? nodes.get(node['parentUuid']) : undefined
      }
    }
  }
  for (const row of rows) {
    const payload = record(row['payload'])
    if (source === 'codex' && row['type'] === 'session_meta' && typeof payload?.['cwd'] === 'string') cwd = payload['cwd']
    if (source === 'claude' && typeof row['cwd'] === 'string') cwd = row['cwd']
    if (source === 'claude' && row['type'] === 'custom-title' && typeof row['customTitle'] === 'string') title = row['customTitle']
    const message = source === 'codex'
      ? row['type'] === 'response_item' && payload?.['type'] === 'message' ? payload : undefined
      : row['type'] === 'user' || row['type'] === 'assistant' ? record(row['message']) : undefined
    if (message === undefined || row['isSidechain'] === true || row['isMeta'] === true) continue
    if (active !== undefined && typeof row['uuid'] === 'string' && !active.has(row['uuid'])) continue
    const role = message['role']
    if (role !== 'user' && role !== 'assistant') continue
    const content = message['content']
    const body = typeof content === 'string' ? content : Array.isArray(content)
      ? content.flatMap((part: unknown) => {
        const block = record(part)
        return block !== undefined && ['text', 'input_text', 'output_text'].includes(String(block['type']))
          && typeof block['text'] === 'string' ? [block['text']] : []
      }).join('\n') : ''
    if (!body.trim()) continue
    const identity = source === 'claude' ? row['uuid'] : message['id']
    if (typeof identity === 'string') {
      if (seen.has(identity)) continue
      seen.add(identity)
    }
    messages.push({ role, text: body })
  }
  if (messages.length === 0) throw new Error('No supported user or assistant text messages')
  return { ...(cwd === undefined ? {} : { cwd }), title: (title ?? messages.find(m => m.role === 'user')?.text ?? 'Imported chat').slice(0, 100), messages }
}

const MAX_BYTES = 16 * 1024 * 1024
const MAX_FILES = 100
const MAX_ENTRIES = 20_000

/** Bounded local discovery and reading of supported vendor transcripts. */
export class ExternalChats {
  private readonly candidates = new Map<string, { path: string; source: ExternalChatSource }>()

  constructor(private readonly roots: Readonly<Record<ExternalChatSource, string>> = {
    claude: join(process.env['CLAUDE_CONFIG_DIR'] ?? join(homedir(), '.claude'), 'projects'),
    codex: join(process.env['CODEX_HOME'] ?? join(homedir(), '.codex'), 'sessions'),
  }) {}

  /**
   * Refresh the private lookup of recent local transcript candidates.
   * @returns at most 100 previews with per-file errors and a truncation indicator.
   */
  async discover(): Promise<{ items: ExternalChat[]; limited: boolean }> {
    const files: { path: string; source: ExternalChatSource; updatedAt: number }[] = []
    let visited = 0
    for (const source of ['claude', 'codex'] as const) {
      const scan = async (directory: string, depth: number): Promise<void> => {
        if (depth > (source === 'claude' ? 1 : 4) || visited >= MAX_ENTRIES) return
        let entries
        try { entries = await readdir(directory, { withFileTypes: true }) } catch (error) {
          if (record(error)?.['code'] === 'ENOENT') return
          throw error
        }
        for (const entry of entries) {
          if (++visited > MAX_ENTRIES) break
          const path = join(directory, entry.name)
          if (entry.isDirectory()) await scan(path, depth + 1)
          else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
            try { files.push({ path, source, updatedAt: (await stat(path)).mtimeMs }) } catch (error) {
              if (record(error)?.['code'] !== 'ENOENT') throw error
            }
          }
        }
      }
      await scan(this.roots[source], 0)
    }
    files.sort((a, b) => b.updatedAt - a.updatedAt || a.path.localeCompare(b.path))
    const items: ExternalChat[] = []
    this.candidates.clear()
    for (const file of files.slice(0, MAX_FILES)) {
      const key = brandString<ExternalChatKey>(createHash('sha256').update(`${file.source}:${resolve(file.path)}`).digest('hex'))
      this.candidates.set(key, file)
      try {
        const parsed = await this.read(key)
        items.push({ key, source: file.source, title: parsed.title, updatedAt: file.updatedAt,
          ...(parsed.cwd === undefined ? {} : { cwd: parsed.cwd }),
          messageCount: parsed.messages.length,
          preview: parsed.messages.map(m => `${m.role}: ${m.text}`).join('\n\n').slice(0, 2000) })
      } catch (error) {
        items.push({ key, source: file.source, title: file.path, updatedAt: file.updatedAt,
          messageCount: 0, preview: '', error: error instanceof Error ? error.message : String(error) })
      }
    }
    return { items, limited: files.length > MAX_FILES || visited >= MAX_ENTRIES }
  }

  /**
   * Read a discovered transcript inside its source store with a 16 MiB limit.
   * @param key - identity from this instance's latest discovery.
   * @returns the parsed text history; unavailable or invalid files reject.
   */
  async read(key: string): Promise<ExternalTranscript> {
    const file = this.candidates.get(key)
    if (file === undefined) throw new Error('Chat is no longer in the discovery list; refresh Import chats')
    const root = await realpath(this.roots[file.source])
    const actual = await realpath(file.path)
    if (!actual.startsWith(root + (process.platform === 'win32' ? '\\' : '/'))) throw new Error('Transcript is outside its source store')
    const handle = await open(actual, 'r')
    try {
      if ((await handle.stat()).size > MAX_BYTES) throw new Error('Transcript exceeds the 16 MiB import limit')
      const buffer = Buffer.alloc(MAX_BYTES + 1)
      let size = 0
      while (size < buffer.length) {
        const next = await handle.read(buffer, size, buffer.length - size, null)
        if (next.bytesRead === 0) break
        size += next.bytesRead
      }
      if (size > MAX_BYTES) throw new Error('Transcript exceeds the 16 MiB import limit')
      return parseExternalTranscript(file.source, buffer.toString('utf8', 0, size))
    } finally { await handle.close() }
  }
}

/** @module Host memory browsing, document import and Graphify graph access. */
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { readFile, mkdir, writeFile, open } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-fs'
import z from '@deepseek-ai/schemastery'
import { z as schema } from 'zod'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { memorixInventory, memorixPage, memorixStoredChunk } from '@deepseek-ai/dsh-knowledge-router'
import type { MemorixPage, MemorixTable, MemorixView } from '@deepseek-ai/dsh-knowledge-router/memorix-types'
import type { McpConnectionReport, McpHumanOperations } from '@deepseek-ai/dsh-mcp-client'
import type {} from '@deepseek-ai/dsh-mcp-client'
import type { MemoryGraph, MemoryImportResult } from './types.ts'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { documentText } from './document-text.ts'
import { MemoryAutomation } from './automation.ts'
import { storeObservation } from './store.ts'
import { runNativeCommand } from '@deepseek-ai/dsh-native-command'

declare module '@deepseek-ai/cordis' { interface Context { memoryWorkspace: MemoryWorkspace } }

/** Local storage selections and upload limits. */
export interface Config {
  /** Connected MCP server name. */
  memorixServer: string
  /** Explicit database override; empty derives it from the provider. */
  databasePath: string
  /** Derived document graph path; empty uses the import directory. */
  graphPath: string
  /** Graphify executable or a launcher such as uv. */
  graphifyCommand: string
  /** Launcher arguments preceding Graphify's own arguments. */
  graphifyArgs: string[]
  /** Directory retaining original uploaded files. */
  importDirectory: string
  /** Maximum records returned by one browse request. */
  pageSize: number
  /** Maximum original upload size. */
  maxDocumentBytes: number
  /** Maximum complete extracted text length. */
  maxDocumentCharacters: number
  /** Maximum Unicode code points stored in one observation. */
  chunkCharacters: number
  /** Maximum complete Graphify export size. */
  maxGraphBytes: number
  /** Save a rolling session digest and compaction summaries to Memorix without a model call. */
  autoSave: boolean
  /** Quiet period after a completed turn before its digest is written. */
  autoSaveDelayMs: number
  /** Surface recent digests of the same workspace when a session starts. */
  recall: boolean
  /** Tell agents when and how to store durable memories while the Memorix store tool is available. */
  policy: boolean
  /** Maximum characters of one saved digest or of the recalled context. */
  memoryCharacters: number
}

/** Authenticated GUI operations; provider calls remain Host-owned. */
export default class MemoryWorkspace extends TypertRemoteService {
  static Config: z<Partial<Config>, Config> = z.object({
    memorixServer: z.string().min(1).default('memorix'),
    databasePath: z.string().default(''), graphPath: z.string().default(''),
    graphifyCommand: z.string().min(1).default('graphify'),
    graphifyArgs: z.array(z.string()).default([]),
    importDirectory: z.string().default(dshHomePath('memorix-documents')),
    pageSize: z.natural().min(1).default(50),
    maxDocumentBytes: z.natural().min(1).default(16 * 1024 * 1024),
    maxDocumentCharacters: z.natural().min(1).default(2_000_000),
    chunkCharacters: z.natural().min(1).default(4800),
    maxGraphBytes: z.natural().min(1).default(16 * 1024 * 1024),
    autoSave: z.boolean().default(true),
    autoSaveDelayMs: z.natural().min(1).default(20_000),
    recall: z.boolean().default(true),
    policy: z.boolean().default(true),
    memoryCharacters: z.natural().min(200).default(3000),
  })

  private readonly lifetime = new AbortController()
  private readonly pending = new Set<Promise<unknown>>()
  private graphQueue: Promise<unknown> = Promise.resolve()
  private readonly automation: MemoryAutomation

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'memoryWorkspace')
    ctx.inject(['tools', 'fs'], (inner) => {
      inner.tools.register(defineTool({
        name: 'memorix_import_file',
        description: 'Import a complete file into persistent Memorix memory when the user asks to remember or upload it. Accepts UTF-8 text, PDF text layers and Office documents. Retains the original and verifies every stored chunk. Partial imports can be retried.',
        parameters: { path: { type: 'string', required: true, description: 'File path, absolute or relative to this chat workspace.' } },
        output: {
          schema: { type: 'string' },
          render: (_args, value) => [{ type: 'text', text: value }],
        },
        execute: async (args, exec) => {
          const signal = AbortSignal.any([exec.signal, this.lifetime.signal])
          signal.throwIfAborted()
          const cwd = exec.agent?.session.header.cwd
          if (cwd === undefined) throw new Error('Memorix file import requires a chat workspace')
          const pending = (async () => {
            const target = await inner.fs.resolve(args.path, { cwd, signal })
            const bytes = await inner.fs.readBytes(target, signal, config.maxDocumentBytes)
            signal.throwIfAborted()
            const result = await this.importBytes(basename(args.path), Buffer.from(bytes).toString('base64'), signal)
            return JSON.stringify(result)
          })()
          this.pending.add(pending)
          try { return await pending } finally { this.pending.delete(pending) }
        },
      }))
    })
    this.automation = new MemoryAutomation(ctx, config, {
      signal: this.lifetime.signal,
      provider: () => this.provider(),
      database: provider => this.database(provider),
      track: (pending) => {
        this.pending.add(pending)
        void pending.then(() => this.pending.delete(pending), () => this.pending.delete(pending))
      },
    })
    ctx.effect(() => async () => {
      await this.automation.close()
      this.lifetime.abort()
      await Promise.allSettled(this.pending)
    })
  }

  private async provider(): Promise<McpHumanOperations> {
    this.lifetime.signal.throwIfAborted()
    const server = this.config.memorixServer
    const provider = await this.ctx.waterfall('mcp/human-operations', server, () => Promise.resolve(undefined))
    if (provider !== undefined) return provider
    const reports: McpConnectionReport[] = []
    this.ctx.emit('mcp-client/inventory', reports)
    const report = reports.find(item => item.serverName === server)
    throw new Error(report === undefined
      ? `Memorix is not connected: no MCP client named "${server}" is mounted in this profile. Add an @deepseek-ai/dsh-mcp-client entry with serverName: ${server} that runs "memorix serve", or set memorixServer on ui-memory-workspace to the serverName of your Memorix client (see docs/user/guide/mcp-memory.md).`
      : `Memorix is not connected: the MCP client "${server}" is ${report.state}${report.error === undefined ? '' : ` (${report.error})`} and is not available to the Memory panel. Mount it globally rather than under one agent, then reload the profile.`)
  }

  private database(provider: McpHumanOperations): string {
    if (!provider.local && this.config.databasePath === '') throw new Error('Remote Memorix requires an explicit local database path for browsing: set databasePath on ui-memory-workspace to the memorix.db file')
    return this.config.databasePath || resolve(provider.cwd || process.cwd(),
      provider.env.MEMORIX_DATA_DIR || join(homedir(), '.memorix', 'data'), 'memorix.db')
  }

  /**
   * Read the complete local provider inventory without modifying it.
   * @returns every stored table and record count across projects and statuses.
   */
  @Remote
  async inventory(): Promise<MemorixTable[]> { return memorixInventory(this.database(await this.provider())) }

  /**
   * Browse or search a provider table with bounded pagination.
   * @param table - table from inventory.
   * @param offset - nonnegative row offset.
   * @param query - literal substring matched against every column.
   * @param view - observation filter: all rows, saved memories only or imported document chunks only.
   * @returns one complete page, newest record first, and the total matching count.
   */
  @Remote
  async page(table: string, offset: number, query: string, view: MemorixView): Promise<MemorixPage> {
    return memorixPage(this.database(await this.provider()), { table, offset, query, view, limit: this.config.pageSize })
  }

  /**
   * Rebuild complete active Memorix documents with the Graphify adapter and load its bounded viewer.
   * @returns the official Graphify viewer, its graph source path and the imported document count; no Graphify run when the count is 0.
   */
  @Remote
  graph(): Promise<MemoryGraph> {
    const pending = this.graphQueue.then(() => this.loadGraph(), () => this.loadGraph())
    this.graphQueue = pending
    this.pending.add(pending)
    void pending.then(() => this.pending.delete(pending), () => this.pending.delete(pending))
    return pending
  }

  private async loadGraph(): Promise<MemoryGraph> {
    const provider = await this.provider()
    const path = resolve(this.config.graphPath || join(this.config.importDirectory, 'graphify-out', 'graph.json'))
    const database = this.database(provider)
    const documents = memorixPage(database, { table: 'observations', offset: 0, limit: 1, query: '', view: 'documents' }).total
    if (documents === 0) return { path, html: '', documents }
    try {
      await runNativeCommand(this.config.graphifyCommand, [...this.config.graphifyArgs,
        'memorix', '--database', database, '--graph', path], this.lifetime.signal, 'hidden')
    } catch (error) { throw this.graphifyFailure(error) }
    await this.readExport(path, false)
    return { path, html: new TextDecoder('utf-8', { fatal: true }).decode(await this.readExport(join(dirname(path), 'graph.html'), true)), documents }
  }

  private graphifyFailure(error: unknown): unknown {
    if (this.lifetime.signal.aborted || !(error instanceof Error)) return error
    const setup = 'Set graphifyCommand on ui-memory-workspace to the Python interpreter that has Graphify installed and graphifyArgs to ["<path>/scripts/graphify-native.py"] (docs/user/guide/mcp-memory.md).'
    if ('code' in error && error.code === 'ENOENT') {
      return new Error(`Graphify could not start: "${this.config.graphifyCommand}" was not found. ${setup}`, { cause: error })
    }
    const stderr = 'stderr' in error && typeof error.stderr === 'string' ? error.stderr.trim() : ''
    return new Error(`Graphify failed: ${(stderr || error.message).slice(-600)}\n${setup}`, { cause: error })
  }

  private async readExport(path: string, content: boolean): Promise<Buffer> {
    const file = await open(path, 'r').catch((error: unknown) => {
      throw new Error(`Graphify finished but wrote no file at ${path}; check graphPath and that graphifyArgs runs the memorix adapter.`, { cause: error })
    })
    try {
      if ((await file.stat()).size > this.config.maxGraphBytes) throw new Error('Graphify export exceeds the configured byte limit; raise maxGraphBytes on ui-memory-workspace')
      if (!content) return Buffer.alloc(0)
      const bytes = await file.readFile({ signal: this.lifetime.signal })
      if (bytes.byteLength > this.config.maxGraphBytes) throw new Error('Graphify export exceeds the configured byte limit; raise maxGraphBytes on ui-memory-workspace')
      return bytes
    } finally { await file.close() }
  }

  /**
   * Retain an uploaded document and import all chunks through Memorix.
   * @param filename - source filename displayed with the memory.
   * @param data - canonical base64 encoding of complete original bytes.
   * @returns verified chunk counts, original path and an explicit partial-failure message.
   */
  @Remote
  importDocument(filename: string, data: string): Promise<MemoryImportResult> {
    const pending = this.importBytes(filename, data)
    this.pending.add(pending)
    void pending.then(() => this.pending.delete(pending), () => this.pending.delete(pending))
    return pending
  }

  private async importBytes(filename: string, data: string, signal = this.lifetime.signal): Promise<MemoryImportResult> {
    schema.string().min(1).max(255).parse(filename)
    schema.string().max(Math.ceil(this.config.maxDocumentBytes / 3) * 4).parse(data)
    const bytes = Buffer.from(data, 'base64')
    if (bytes.toString('base64') !== data) throw new Error('Document upload is not canonical base64')
    if (bytes.byteLength === 0 || bytes.byteLength > this.config.maxDocumentBytes) throw new Error('Document exceeds the configured byte limit or is empty')
    const provider = await this.provider()
    const hash = createHash('sha256').update(bytes).digest('hex')
    const text = await documentText(this.ctx, filename, bytes, hash, this.config.maxDocumentCharacters, signal)
    schema.string().min(1).max(this.config.maxDocumentCharacters).parse(text)
    if (text.trim() === '') throw new Error('The document has no extractable text; scanned documents require OCR')
    signal.throwIfAborted()
    const originalPath = join(this.config.importDirectory, `${hash}${extname(filename).toLowerCase()}`)
    await mkdir(this.config.importDirectory, { recursive: true, mode: 0o700 })
    try { await writeFile(originalPath, bytes, { flag: 'wx', mode: 0o600 }) }
    catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
      if (!Buffer.from(await readFile(originalPath)).equals(bytes)) throw new Error('Stored document content does not match its identifier')
    }
    const characters = Array.from(text)
    const total = Math.ceil(characters.length / this.config.chunkCharacters)
    const result: MemoryImportResult = { filename, originalPath, completed: 0, total, error: null }
    for (let index = 0; index < total; index++) {
      const topicKey = `document:${hash}:part:${index + 1}`
      const narrative = characters.slice(index * this.config.chunkCharacters, (index + 1) * this.config.chunkCharacters).join('')
      try {
        signal.throwIfAborted()
        const stored = await storeObservation(provider, {
          entityName: `document:${hash}`, type: 'discovery', title: `${basename(filename)} (${index + 1}/${total})`,
          narrative, topicKey, filesModified: [originalPath],
        }, signal, 'document chunk')
        if (!memorixStoredChunk(this.database(provider), stored.id, stored.project, topicKey, narrative)) {
          throw new Error('Memorix did not persist the complete document chunk')
        }
        result.completed++
      } catch (error) {
        result.error = error instanceof Error ? error.message : 'Document import failed'
        break
      }
    }
    return result
  }
}

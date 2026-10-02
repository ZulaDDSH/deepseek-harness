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
import type { MemorixPage, MemorixTable } from '@deepseek-ai/dsh-knowledge-router/memorix-types'
import type { McpHumanOperations } from '@deepseek-ai/dsh-mcp-client'
import type {} from '@deepseek-ai/dsh-mcp-client'
import type { MemoryGraph, MemoryImportResult } from './types.ts'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { documentText } from './document-text.ts'
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
  })

  private readonly lifetime = new AbortController()
  private readonly pending = new Set<Promise<unknown>>()
  private graphQueue: Promise<unknown> = Promise.resolve()

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
    ctx.effect(() => async () => {
      this.lifetime.abort()
      await Promise.allSettled(this.pending)
    })
  }

  private async provider(): Promise<McpHumanOperations> {
    this.lifetime.signal.throwIfAborted()
    const provider = await this.ctx.waterfall('mcp/human-operations', this.config.memorixServer, () => Promise.resolve(undefined))
    if (provider === undefined) throw new Error('Memorix is not connected in this profile')
    return provider
  }

  private database(provider: McpHumanOperations): string {
    if (!provider.local && this.config.databasePath === '') throw new Error('Remote Memorix requires an explicit local database path for browsing')
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
   * @returns one complete page and total matching count.
   */
  @Remote
  async page(table: string, offset: number, query: string): Promise<MemorixPage> {
    return memorixPage(this.database(await this.provider()), { table, offset, query, limit: this.config.pageSize })
  }

  /**
   * Rebuild complete active Memorix documents with the Graphify adapter and load its bounded viewer.
   * @returns the official Graphify viewer and its graph source path.
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
    memorixInventory(database)
    await runNativeCommand(this.config.graphifyCommand, [...this.config.graphifyArgs,
      'memorix', '--database', database, '--graph', path], this.lifetime.signal, 'hidden')
    await this.readExport(path)
    return { path, html: new TextDecoder('utf-8', { fatal: true }).decode(await this.readExport(join(dirname(path), 'graph.html'))) }
  }

  private async readExport(path: string): Promise<Buffer> {
    const file = await open(path, 'r')
    try {
      const buffer = Buffer.alloc(this.config.maxGraphBytes + 1)
      let length = 0
      while (length < buffer.length) {
        this.lifetime.signal.throwIfAborted()
        const result = await file.read(buffer, length, buffer.length - length, null)
        if (result.bytesRead === 0) break
        length += result.bytesRead
      }
      if (length > this.config.maxGraphBytes) throw new Error('Graphify export exceeds the configured byte limit')
      return buffer.subarray(0, length)
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
        const outcome = schema.object({
          isError: schema.boolean().optional(),
          content: schema.array(schema.object({ type: schema.string(), text: schema.string().optional() })),
        }).parse(
          await provider.call('memorix_store', {
            entityName: `document:${hash}`, type: 'discovery', title: `${basename(filename)} (${index + 1}/${total})`,
            narrative, topicKey, filesModified: [originalPath],
          }, signal))
        if (outcome.isError === true) throw new Error('Memorix rejected this document chunk')
        const acknowledgement = outcome.content.filter(item => item.type === 'text').map(item => item.text ?? '').join('\n')
        const stored = new RegExp('\\[(?:OK|UPDATED)\\] (?:Stored|Updated) observation #(\\d+) [^\\n]*\\n'
          + 'Entity: [^\\n]*? \\| Project: ([^|\\n]+) \\| Topic:').exec(acknowledgement)
        if (stored === null || !memorixStoredChunk(this.database(provider), Number(stored[1]), (stored[2] ?? '').trim(), topicKey, narrative)) {
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

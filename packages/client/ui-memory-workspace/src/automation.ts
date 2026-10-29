/** @module Memory policy, per-turn chat saves, first-message recall and status for the connected Memorix server. */
import { createHash } from 'node:crypto'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, parse, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { McpHumanOperations } from '@deepseek-ai/dsh-mcp-client'
import { memorixObservations, memorixRecent, memorixStoredChunk, registeredToolName } from '@deepseek-ai/dsh-knowledge-router'
import type { MemorixObservationRecord, MemorixRecentObservation } from '@deepseek-ai/dsh-knowledge-router/memorix-types'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import { cliTerminalProfileOf } from '@deepseek-ai/dsh-agent'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-compaction'
import { callMemorix, storeObservation } from './store.ts'
import type { MemoryActivity } from './types.ts'

/** Observation type Memorix files chat records under. */
const CHAT_TYPE = 'session-request'
const PROMPT_CHARACTERS = 400
const OUTCOME_CHARACTERS = 800
const QUERY_CHARACTERS = 300
const RECALL_DIGESTS = 3
const RECALL_SEARCH_LIMIT = 8
const RECALL_BUDGET_MS = 3000
const WRITE_TIMEOUT_MS = 60_000
const FLUSH_TIMEOUT_MS = 5000
const DOCUMENTS_ROOT = 'documents'
const SECRET = new RegExp([
  String.raw`\b(?:sk|ghp|gho|ghs|ghu|ghr|xox[abprs])[-_][\w-]{16,}`,
  String.raw`\bgithub_pat_\w{20,}`,
  String.raw`\bAIza[\w-]{30,}`,
  String.raw`\b(?:AKIA|ASIA)[0-9A-Z]{16}\b`,
  String.raw`-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----`,
  String.raw`\beyJ[\w-]+\.[\w-]+\.[\w-]+`,
  String.raw`["']?(?<![\w-])[\w-]*(?:api[_-]?key|access[_-]?key|private[_-]?key|[_-]key|secret|token|password|passwd)[\w-]*["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;}]+)`,
  String.raw`\bBearer\s+[\w.~+/-]{16,}`,
].join('|'), 'gi')
const URL_USERINFO = /\b([a-z][\w+.-]*:\/\/)[^\s:/@]+:[^\s@/]+@/gi

/** Automatic-memory settings the host config supplies. */
export interface AutomationConfig {
  memorixServer: string
  databasePath: string
  /** Master switch for chat saves and recall, read on every use so a Settings change applies at once. */
  chatMemory: () => boolean
  /** Save each finished chat turn and compaction summaries without a model call. */
  autoSave: boolean
  /** Search earlier chats for the first message of a session and inject the matches. */
  recall: boolean
  /** Add the memory-saving policy section while the store tool is visible. */
  policy: boolean
  /** Upper bound on one saved or recalled text, in characters. */
  memoryCharacters: number
}

/** Host operations the automation reads through. */
export interface AutomationHost {
  /** Plugin lifetime. */
  readonly signal: AbortSignal
  /** Connected provider, or a failure naming what to configure. */
  provider(): Promise<McpHumanOperations>
  /** Local database path for that provider. */
  database(provider: McpHumanOperations): string
  /** Keep a background write so teardown waits for it. */
  track(pending: Promise<unknown>): void
}

/** One finished chat turn. */
export interface Turn { readonly index: number; readonly prompt: string; readonly outcome: string }
interface ChatRecord { readonly topicKey: string; readonly title: string; readonly narrative: string }
interface SessionLike {
  readonly id: string
  readonly header: { readonly cwd?: string | undefined; readonly createdAt: number; readonly origin?: string | undefined }
}
interface BlockLike { readonly type: string; readonly text?: string }

/**
 * Remove credential-shaped text and collapse whitespace.
 * @param text - model or user text bound for memory.
 * @returns single-spaced text with secrets replaced by a marker.
 */
export function scrub(text: string): string {
  return text.replace(URL_USERINFO, '$1[redacted]@').replace(SECRET, '[redacted]').replace(/\s+/g, ' ').trim()
}

function clip(text: string, limit: number): string {
  const characters = Array.from(text)
  return characters.length <= limit ? text : `${characters.slice(0, limit - 1).join('')}…`
}

/**
 * Join the text blocks of one message.
 * @param content - model-visible content blocks.
 * @returns the concatenated text, empty when there are none.
 */
export function blocksText(content: readonly BlockLike[]): string {
  return content.filter(block => block.type === 'text').map(block => block.text ?? '').join('\n')
}

/**
 * Name the memory entity for one workspace, stable across sessions and distinct between folders.
 * @param cwd - session working directory.
 * @returns entity name carrying the folder name and a short path hash.
 */
export function workspaceEntity(cwd: string): string {
  return `dsh-workspace:${basename(cwd) || 'root'}-${workspaceHash(cwd)}`
}

function workspaceHash(cwd: string): string {
  const path = resolve(cwd)
  const key = process.platform === 'win32' ? path.toLowerCase() : path
  return createHash('sha256').update(key).digest('hex').slice(0, 8)
}

function sameFolder(left: string, right: string): boolean {
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right
}

function homeDirectory(): string {
  const { USERPROFILE, HOME } = process.env
  const configured = process.platform === 'win32' ? USERPROFILE?.trim() || HOME?.trim() : HOME?.trim() || USERPROFILE?.trim()
  return resolve(configured || homedir())
}

async function usableGitRoot(cwd: string): Promise<boolean> {
  const start = resolve(cwd)
  const home = homeDirectory()
  if (sameFolder(start, home)) return false
  for (let dir = start; dir !== parse(start).root; dir = dirname(dir)) {
    if (await stat(join(dir, '.git')).then(() => true, () => false)) return !sameFolder(dir, home)
  }
  return false
}

async function ensureEmptyRepository(root: string): Promise<void> {
  const git = join(root, '.git')
  try {
    await Promise.all(['objects', join('refs', 'heads'), join('refs', 'tags')].map(name => mkdir(join(git, name), { recursive: true })))
    await writeFile(join(git, 'HEAD'), 'ref: refs/heads/main\n', { flag: 'wx' }).catch((error: unknown) => {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
    })
  } catch (error) {
    throw new Error(`Cannot prepare the Memorix project folder ${root}: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
  }
}

async function memoryProjectRoot(cwd: string | undefined): Promise<string> {
  if (cwd !== undefined && await usableGitRoot(cwd)) return cwd
  const root = dshHomePath('memorix-roots', cwd === undefined ? DOCUMENTS_ROOT : workspaceHash(cwd))
  await ensureEmptyRepository(root)
  return root
}

/** Finished chat turns of one session within this Host run, numbered for their topic keys. */
export class SessionTurns {
  private count = 0
  private prompt = ''
  private outcome = ''

  constructor(readonly session: SessionLike, readonly segment: number) {}

  /** Topic-key prefix shared by every record of this session in this Host run. */
  get topicPrefix(): string { return `dsh-session:${this.session.id}:${this.segment}` }

  /**
   * Record a human prompt, starting a new turn.
   * @param text - prompt text.
   */
  begin(text: string): void {
    this.prompt = clip(scrub(text), PROMPT_CHARACTERS)
    this.outcome = ''
  }

  /**
   * Record the latest assistant text; the last one before the turn ends is its outcome.
   * @param text - assistant message text.
   */
  answer(text: string): void {
    const clean = scrub(text)
    if (clean !== '') this.outcome = clip(clean, OUTCOME_CHARACTERS)
  }

  /**
   * Close the current turn.
   * @returns the finished turn, or undefined when it carried neither a request nor a reply.
   */
  finish(): Turn | undefined {
    const prompt = this.prompt
    const outcome = this.outcome
    this.prompt = ''
    this.outcome = ''
    if (prompt === '' && outcome === '') return undefined
    this.count++
    return { index: this.count, prompt, outcome }
  }
}

/**
 * Render one finished turn as its own observation, with a topic key unique to that turn.
 * @param session - session that produced the turn.
 * @param segment - Host-run segment of the session's topic keys.
 * @param turn - finished turn.
 * @param limit - maximum characters of the narrative.
 * @returns the topic key, title and bounded narrative of the observation.
 */
export function turnRecord(session: SessionLike, segment: number, turn: Turn, limit: number): ChatRecord {
  const head = `Workspace: ${session.header.cwd ?? 'unknown'}\nSession: ${session.id}\nTurn ${turn.index}.`
  return {
    topicKey: `dsh-session:${session.id}:${segment}:turn:${turn.index}`,
    title: `Turn ${turn.index}: ${clip(turn.prompt || session.id, 70)}`,
    narrative: clip(`${head}\nUser: ${turn.prompt || '(none)'} | Outcome: ${turn.outcome || '(no text reply)'}`, limit),
  }
}

/**
 * State the memory-saving policy for agents that can reach the store tool.
 * @param store - registered public name of `memorix_store`.
 * @param search - registered public name of `memorix_search`, when visible.
 * @param automatic - whether the Host also records finished chat turns.
 * @returns the section text.
 */
export function memoryPolicy(store: string, search: string | undefined, automatic: boolean): string {
  return [
    `Persistent memory is available through ${store}${search === undefined ? '' : ` and ${search}`}. Use it regularly without waiting to be asked.`,
    search === undefined ? '' : `Before a task that may depend on earlier work, call ${search} for relevant decisions, preferences and known problems, then use what applies.`,
    `Call ${store} as soon as you learn something durable:\n- a decision and the reason for it\n- a user preference or correction\n- a project fact the code does not show, such as an environment quirk, a hidden constraint, or a failure and its fix\n- the verified outcome of finished work: what changed and how it was checked`,
    'Write one fact per memory with a short title and a few sentences. Give a stable topicKey to a fact that may change, so it is updated instead of duplicated. Do not store secrets or credentials, raw transcripts, temporary state, or anything easy to read from the repository. On a read-only task store nothing unless the user asks.',
    automatic ? 'The harness also records each finished chat turn automatically, so record only durable knowledge, not routine progress.' : '',
  ].filter(text => text !== '').join('\n\n')
}

/**
 * Render recalled notes as bounded context.
 * @param rows - recalled observations, most relevant or newest first.
 * @param limit - maximum total characters.
 * @returns the context text, empty when there is nothing to recall.
 */
export function recallText(rows: readonly { title: string; narrative: string; createdAt: string }[], limit: number): string {
  if (rows.length === 0) return ''
  const head = 'Automatic notes from earlier chats in this workspace. They may be stale; check them against the current code and the user\'s request before relying on them.'
  const share = Math.max(80, Math.floor((limit - head.length) / rows.length))
  return clip([head, ...rows.map(row => `- ${row.createdAt.slice(0, 10)} ${row.title}\n${clip(row.narrative, share)}`)].join('\n'), limit)
}

/** Wires the policy section, per-turn saves and first-message recall onto the Host context. */
export class MemoryAutomation {
  private readonly sessions = new Map<string, SessionTurns>()
  private readonly recalls = new Map<string, Promise<string>>()
  private readonly cli = new Set<string>()
  private readonly bound = new WeakMap<McpHumanOperations, string>()
  private readonly reported = new Set<string>()
  private line: Promise<unknown> = Promise.resolve()
  private activity: MemoryActivity = {}

  constructor(private readonly ctx: Context, private readonly config: AutomationConfig, private readonly host: AutomationHost) {
    if (config.policy) {
      ctx.inject(['systemPrompt', 'tools'], (inner) => {
        inner.systemPrompt.section({
          name: 'memory:policy',
          order: inner.systemPrompt.getSectionOrder('KNOWLEDGE_POLICY'),
          text: (context) => {
            const schemas = inner.tools.schemas(context.scope)
            const store = registeredToolName(schemas, config.memorixServer, 'memorix_store')
            return store === undefined ? '' : memoryPolicy(store, registeredToolName(schemas, config.memorixServer, 'memorix_search'), config.autoSave)
          },
        })
      })
    }
    if (config.recall) {
      ctx.inject(['systemPrompt'], (inner) => {
        inner.systemPrompt.context({
          name: 'memory:recall',
          order: inner.systemPrompt.getContextOrder('MEMORY_RECALL'),
          text: '',
        })
      })
      ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
        const result = await next()
        const pending = context.agent === undefined || !config.chatMemory() ? undefined : this.recalls.get(context.agent.session.id)
        if (pending === undefined) return result
        const text = await new Promise<string>((resolve) => {
          if (context.signal?.aborted === true) { resolve(''); return }
          context.signal?.addEventListener('abort', () => { resolve('') }, { once: true })
          void pending.then(resolve)
        })
        return { ...result, contexts: result.contexts.map(entry => entry.name === 'memory:recall' ? { ...entry, text } : entry) }
      })
      ctx.on('agent/inbox/inserted', ({ agent, message }) => {
        const session = agent.session
        if (this.recalls.has(session.id) || message.source.kind !== 'user' || !this.eligible(session)) return
        this.recalls.set(session.id, this.recallFirst(session, blocksText(message.content)))
      })
    }
    if (config.autoSave) {
      ctx.on('session/event', (session, event) => {
        if (!this.eligible(session)) return
        switch (event.type) {
          case 'user/message':
            if (event.data.source.kind === 'user') this.turns(session).begin(blocksText(event.data.content))
            return
          case 'assistant/message':
            if (event.data.interrupted !== true) this.turns(session).answer(blocksText(event.data.message.content))
            return
          case 'turn/end': {
            if (event.data.reason.kind !== 'completed') return
            const log = this.turns(session)
            const turn = log.finish()
            if (turn !== undefined) this.enqueue(session, turnRecord(session, log.segment, turn, config.memoryCharacters))
            return
          }
          case 'compaction/summary':
            this.checkpoint(session, `compaction:${event.data.compactionId}`, blocksText(event.data.summary))
            return
          default:
        }
      })
    }
    ctx.on('memory/lookup', async (query, session, signal, next) => {
      if (!this.eligible(session)) return next()
      const text = await this.lookup(session, query, signal)
      return text === '' ? next() : text
    })
    ctx.on('session/disposed', (session) => {
      this.sessions.delete(session.id)
      this.recalls.delete(session.id)
      this.cli.delete(session.id)
    })
    ctx.on('agent/created', ({ agent }) => {
      if (cliTerminalProfileOf(ctx, agent.session) !== undefined) this.cli.add(agent.session.id)
    })
  }

  /**
   * Wait for queued writes, bounded by the flush timeout.
   * @returns once the queue drains or the timeout passes.
   */
  async close(): Promise<void> {
    await Promise.race([
      this.line.catch(() => undefined),
      new Promise<void>((resolve) => { setTimeout(resolve, FLUSH_TIMEOUT_MS).unref() }),
    ])
  }

  /**
   * Snapshot the latest save and recall outcomes.
   * @returns the last success time and the last failure, per action.
   */
  snapshot(): MemoryActivity {
    return { ...this.activity }
  }

  private eligible(session: SessionLike): boolean {
    return session.header.origin !== 'subagent' && session.header.cwd !== undefined && !this.cli.has(session.id) && this.config.chatMemory()
  }

  private turns(session: SessionLike): SessionTurns {
    let log = this.sessions.get(session.id)
    if (log === undefined) {
      log = new SessionTurns(session, Date.now())
      this.sessions.set(session.id, log)
    }
    return log
  }

  private enqueue(session: SessionLike, record: ChatRecord): void {
    const save = this.exclusive(async () => {
      if (this.host.signal.aborted || !this.config.chatMemory()) return
      await this.save(session, record)
      this.succeeded('save')
    }).catch((error: unknown) => { this.report(error, 'save') })
    this.host.track(save)
  }

  private checkpoint(session: SessionLike, name: string, summary: string): void {
    const clean = scrub(summary)
    if (clean === '') return
    const head = `Workspace: ${session.header.cwd ?? 'unknown'}\nSession: ${session.id}\nSummary written when the conversation was compacted.\n`
    this.enqueue(session, {
      topicKey: `${this.turns(session).topicPrefix}:${name}`,
      title: `Session summary: ${clip(clean, 60)}`,
      narrative: head + clip(clean, Math.max(80, this.config.memoryCharacters - head.length)),
    })
  }

  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const next = this.line.then(work)
    this.line = next.catch(() => undefined)
    return next
  }

  private async bind(provider: McpHumanOperations, cwd: string | undefined, signal: AbortSignal): Promise<void> {
    const key = cwd ?? DOCUMENTS_ROOT
    if (this.bound.get(provider) === key) return
    const projectRoot = await memoryProjectRoot(cwd)
    await callMemorix(provider, 'memorix_session_start', { projectRoot, agent: 'dsh' }, signal, 'workspace binding')
    this.bound.set(provider, key)
  }

  /**
   * Run one Memorix write inside the project of a workspace, with no other bind or save interleaved.
   * @param provider - connected Memorix operations.
   * @param cwd - workspace folder, or undefined for the shared documents project.
   * @param signal - bind lifetime.
   * @param work - the write, run once the project is bound.
   * @returns whatever the write returns.
   */
  inProject<T>(provider: McpHumanOperations, cwd: string | undefined, signal: AbortSignal, work: () => Promise<T>): Promise<T> {
    return this.exclusive(async () => {
      await this.bind(provider, cwd, signal)
      return work()
    })
  }

  private async save(session: SessionLike, record: ChatRecord): Promise<void> {
    const cwd = session.header.cwd ?? ''
    const signal = AbortSignal.any([this.host.signal, AbortSignal.timeout(WRITE_TIMEOUT_MS)])
    const provider = await this.host.provider()
    await this.bind(provider, cwd, signal)
    const stored = await storeObservation(provider, {
      entityName: workspaceEntity(cwd), type: CHAT_TYPE, title: record.title, narrative: record.narrative, topicKey: record.topicKey,
      concepts: ['dsh-session', 'automatic-turn'],
    }, signal, 'chat turn')
    const database = provider.local || this.config.databasePath !== '' ? this.host.database(provider) : undefined
    if (database !== undefined && !memorixStoredChunk(database, stored.id, stored.project, record.topicKey, record.narrative)) {
      throw new Error('Memorix did not persist the complete chat turn')
    }
  }

  private recallFirst(session: SessionLike, prompt: string): Promise<string> {
    const query = scrub(prompt)
    if (query === '') return Promise.resolve('')
    let timer: NodeJS.Timeout | undefined
    const expired = new Promise<undefined>((resolve) => { timer = setTimeout(() => { resolve(undefined) }, RECALL_BUDGET_MS) })
    return Promise.race([this.recallNotes(session, query), expired]).then((text) => {
      if (text !== undefined) return text
      this.report(new Error(`memory search did not finish within ${RECALL_BUDGET_MS / 1000} s, so this chat starts with the latest notes`), 'recall')
      return this.recentNotes(session)
    }, (error: unknown) => {
      this.report(error, 'recall')
      return ''
    }).finally(() => { clearTimeout(timer) })
  }

  private async recallNotes(session: SessionLike, query: string): Promise<string> {
    const cwd = session.header.cwd ?? ''
    const provider = await this.host.provider()
    const database = this.host.database(provider)
    let rows: readonly MemorixObservationRecord[] = []
    try {
      rows = await this.exclusive(() => this.search(provider, session, cwd, query, database))
      this.succeeded('recall')
    } catch (error) {
      this.report(error, 'recall')
    }
    return recallText(rows.length > 0 ? rows : this.recent(session, database), this.config.memoryCharacters)
  }

  private async lookup(session: SessionLike, query: string, signal: AbortSignal): Promise<string> {
    const text = scrub(query)
    if (text === '') return ''
    try {
      const provider = await this.host.provider()
      const database = this.host.database(provider)
      const rows = await this.exclusive(() => this.search(provider, session, session.header.cwd ?? '', text, database, signal))
      this.succeeded('recall')
      return recallText(rows, this.config.memoryCharacters)
    } catch (error) {
      if (!signal.aborted) this.report(error, 'recall')
      return ''
    }
  }

  private async recentNotes(session: SessionLike): Promise<string> {
    try {
      const database = this.host.database(await this.host.provider())
      return recallText(this.recent(session, database), this.config.memoryCharacters)
    } catch (error) {
      this.report(error, 'recall')
      return ''
    }
  }

  private recent(session: SessionLike, database: string): MemorixRecentObservation[] {
    return memorixRecent(database, {
      entityName: workspaceEntity(session.header.cwd ?? ''), excludeTopicPrefix: `dsh-session:${session.id}:`,
      before: new Date().toISOString(), limit: RECALL_DIGESTS,
    })
  }

  private async search(provider: McpHumanOperations, session: SessionLike, cwd: string, query: string,
    database: string, caller?: AbortSignal): Promise<MemorixObservationRecord[]> {
    const signal = AbortSignal.any([this.host.signal, AbortSignal.timeout(RECALL_BUDGET_MS), ...caller === undefined ? [] : [caller]])
    await this.bind(provider, cwd, signal)
    const text = await callMemorix(provider, 'memorix_search', {
      query: clip(query, QUERY_CHARACTERS), limit: RECALL_SEARCH_LIMIT, scope: 'project', quality: 'fast', status: 'active',
    }, signal, 'recall search')
    const ids = [...new Set([...text.matchAll(/\bobs:(\d+)/g)].map(match => Number(match[1])))]
    const entity = workspaceEntity(cwd)
    return memorixObservations(database, ids)
      .filter(row => row.entityName === entity && !(row.topicKey ?? '').startsWith(`dsh-session:${session.id}:`))
      .slice(0, RECALL_DIGESTS)
  }

  private succeeded(action: 'save' | 'recall'): void {
    const at = new Date().toISOString()
    this.activity = action === 'save'
      ? { ...this.activity, lastSavedAt: at, saveFailure: undefined }
      : { ...this.activity, lastRecalledAt: at, recallFailure: undefined }
  }

  private report(error: unknown, action: 'save' | 'recall'): void {
    if (this.host.signal.aborted) return
    const message = error instanceof Error ? error.message : String(error)
    const failure = { message, at: new Date().toISOString() }
    this.activity = action === 'save' ? { ...this.activity, saveFailure: failure } : { ...this.activity, recallFailure: failure }
    const entry = `memory-workspace: automatic memory ${action} failed: ${message}`
    const key = `${action}:${message}`
    if (this.reported.has(key)) this.ctx.logger.info(entry)
    else {
      this.reported.add(key)
      this.ctx.logger.warn(entry)
    }
  }
}

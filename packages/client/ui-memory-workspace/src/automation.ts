/** @module Memory policy, automatic checkpoint saves and session-start recall for the connected Memorix server. */
import { createHash } from 'node:crypto'
import { basename } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { McpHumanOperations } from '@deepseek-ai/dsh-mcp-client'
import { memorixRecent, memorixStoredChunk, registeredToolName } from '@deepseek-ai/dsh-knowledge-router'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-compaction'
import { storeObservation } from './store.ts'

/** Observation type Memorix files session records under. */
const DIGEST_TYPE = 'session-request'
/** Turns kept in memory per session; older ones fall out of the digest first. */
const MAX_TURNS = 40
const PROMPT_CHARACTERS = 400
const OUTCOME_CHARACTERS = 800
const RECALL_DIGESTS = 3
const FLUSH_TIMEOUT_MS = 5000
const SECRET = new RegExp([
  String.raw`\b(?:sk|ghp|gho|ghs|xox[abp])[-_][\w-]{16,}`,
  String.raw`\bAKIA[0-9A-Z]{16}\b`,
  String.raw`\b(?:password|passwd|secret|token|api[_-]?key)\b\s*[:=]\s*\S+`,
  String.raw`\bBearer\s+[\w.~+/-]{16,}`,
].join('|'), 'gi')

/** Automatic-memory settings the host config supplies. */
export interface AutomationConfig {
  memorixServer: string
  databasePath: string
  /** Save a rolling session digest and compaction summaries without a model call. */
  autoSave: boolean
  /** Quiet period after a completed turn before its digest is written. */
  autoSaveDelayMs: number
  /** Surface recent workspace digests when a session starts. */
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

interface Turn { prompt: string; outcome: string }
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
  return text.replace(SECRET, '[redacted]').replace(/\s+/g, ' ').trim()
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
  const key = process.platform === 'win32' ? cwd.toLowerCase() : cwd
  return `dsh-workspace:${basename(cwd) || 'root'}-${createHash('sha256').update(key).digest('hex').slice(0, 8)}`
}

/** Rolling record of one session's completed turns within this Host run. */
export class SessionDigest {
  /** Last narrative acknowledged by Memorix. */
  savedHash = ''
  /** Quiet-period timer for the next save. */
  timer: NodeJS.Timeout | undefined
  /** Serializes this session's writes. */
  writes: Promise<void> = Promise.resolve()
  private readonly turns: Turn[] = []
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
   * @returns whether the turn carried anything worth saving.
   */
  finish(): boolean {
    const turn = { prompt: this.prompt, outcome: this.outcome }
    this.prompt = ''
    this.outcome = ''
    if (turn.prompt === '' && turn.outcome === '') return false
    this.turns.push(turn)
    if (this.turns.length > MAX_TURNS) this.turns.shift()
    return true
  }

  /**
   * Render the digest within a character bound, dropping the oldest turns first.
   * @param limit - maximum characters.
   * @returns the narrative, or undefined when no turn was recorded.
   */
  narrative(limit: number): string | undefined {
    if (this.turns.length === 0) return undefined
    const head = `Workspace: ${this.session.header.cwd ?? 'unknown'}\nSession: ${this.session.id}\nAutomatic digest of the latest completed turns.`
    const lines: string[] = []
    let used = Array.from(head).length
    for (let index = this.turns.length - 1; index >= 0; index--) {
      const turn = this.turns[index]
      if (turn === undefined) continue
      const line = `Turn ${index + 1}. User: ${turn.prompt || '(none)'} | Outcome: ${turn.outcome || '(no text reply)'}`
      const cost = Array.from(line).length + 1
      if (used + cost > limit) {
        if (lines.length === 0) lines.push(clip(line, Math.max(1, limit - used - 1)))
        break
      }
      lines.unshift(line)
      used += cost
    }
    return `${head}\n${lines.join('\n')}`
  }

  /** Title naming the session by its first remembered request. */
  get title(): string {
    return `Session: ${clip(this.turns[0]?.prompt || this.session.id, 70)}`
  }
}

/**
 * State the memory-saving policy for agents that can reach the store tool.
 * @param store - registered public name of `memorix_store`.
 * @param search - registered public name of `memorix_search`, when visible.
 * @param automatic - whether the Host also records session digests.
 * @returns the section text.
 */
export function memoryPolicy(store: string, search: string | undefined, automatic: boolean): string {
  return [
    `Persistent memory is available through ${store}${search === undefined ? '' : ` and ${search}`}. Use it regularly without waiting to be asked.`,
    search === undefined ? '' : `Before a task that may depend on earlier work, call ${search} for relevant decisions, preferences and known problems, then use what applies.`,
    `Call ${store} as soon as you learn something durable:\n- a decision and the reason for it\n- a user preference or correction\n- a project fact the code does not show, such as an environment quirk, a hidden constraint, or a failure and its fix\n- the verified outcome of finished work: what changed and how it was checked`,
    'Write one fact per memory with a short title and a few sentences. Give a stable topicKey to a fact that may change, so it is updated instead of duplicated. Do not store secrets or credentials, raw transcripts, temporary state, or anything easy to read from the repository. On a read-only task store nothing unless the user asks.',
    automatic ? 'The harness also saves a short session digest automatically, so record only durable knowledge, not routine progress.' : '',
  ].filter(text => text !== '').join('\n\n')
}

/**
 * Render recalled digests as bounded context.
 * @param rows - recent digests, newest first.
 * @param limit - maximum total characters.
 * @returns the context text, empty when there is nothing to recall.
 */
export function recallText(rows: readonly { title: string; narrative: string; createdAt: string }[], limit: number): string {
  if (rows.length === 0) return ''
  const head = 'Automatic notes from earlier sessions in this workspace. They may be stale; check them against the current code and the user\'s request before relying on them.'
  const share = Math.max(80, Math.floor((limit - head.length) / rows.length))
  return clip([head, ...rows.map(row => `- ${row.createdAt.slice(0, 10)} ${row.title}\n${clip(row.narrative, share)}`)].join('\n'), limit)
}

/** Wires the policy section, checkpoint saves and recall onto the Host context. */
export class MemoryAutomation {
  private readonly digests = new Map<string, SessionDigest>()
  private readonly recalled = new Map<string, string>()
  private readonly reported = new Set<string>()

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
          text: context => this.recalled.get(context.agent?.session.id ?? '') ?? '',
        })
      })
    }
    if (config.autoSave) {
      ctx.on('session/event', (session, event) => {
        if (session.header.origin === 'subagent') return
        switch (event.type) {
          case 'user/message':
            if (event.data.source.kind === 'user') this.digest(session).begin(blocksText(event.data.content))
            return
          case 'assistant/message':
            if (event.data.interrupted !== true) this.digest(session).answer(blocksText(event.data.message.content))
            return
          case 'turn/end':
            if (event.data.reason.kind === 'completed' && this.digest(session).finish()) this.schedule(this.digest(session))
            return
          case 'compaction/summary':
            this.checkpoint(this.digest(session), `compaction:${event.data.compactionId}`, blocksText(event.data.summary))
            return
          default:
        }
      })
    }
    ctx.on('session/disposed', (session) => {
      const digest = this.digests.get(session.id)
      this.digests.delete(session.id)
      this.recalled.delete(session.id)
      if (digest?.timer !== undefined) this.flush(digest)
    })
    if (config.recall) {
      ctx.on('agent/created', async ({ agent }) => { await this.recall(agent.session) })
    }
  }

  /**
   * Write every digest still waiting for its quiet period.
   * @returns once the writes settle or the flush timeout passes.
   */
  async close(): Promise<void> {
    const waiting = [...this.digests.values()].filter(digest => digest.timer !== undefined)
    for (const digest of waiting) this.flush(digest)
    await Promise.race([
      Promise.allSettled(waiting.map(digest => digest.writes)),
      new Promise<void>((resolve) => { setTimeout(resolve, FLUSH_TIMEOUT_MS).unref() }),
    ])
  }

  private digest(session: SessionLike): SessionDigest {
    let digest = this.digests.get(session.id)
    if (digest === undefined) {
      digest = new SessionDigest(session, Date.now())
      this.digests.set(session.id, digest)
    }
    return digest
  }

  private schedule(digest: SessionDigest): void {
    clearTimeout(digest.timer)
    digest.timer = setTimeout(() => { this.flush(digest) }, this.config.autoSaveDelayMs)
    digest.timer.unref()
  }

  private flush(digest: SessionDigest): void {
    clearTimeout(digest.timer)
    digest.timer = undefined
    const narrative = digest.narrative(this.config.memoryCharacters)
    if (narrative !== undefined) this.enqueue(digest, digest.topicPrefix, digest.title, narrative)
  }

  private checkpoint(digest: SessionDigest, name: string, summary: string): void {
    const clean = scrub(summary)
    if (clean === '') return
    const head = `Workspace: ${digest.session.header.cwd ?? 'unknown'}\nSession: ${digest.session.id}\nSummary written when the conversation was compacted.\n`
    this.enqueue(digest, `${digest.topicPrefix}:${name}`, `Session summary: ${clip(clean, 60)}`, head + clip(clean, Math.max(80, this.config.memoryCharacters - head.length)))
  }

  private enqueue(digest: SessionDigest, topicKey: string, title: string, narrative: string): void {
    const hash = createHash('sha256').update(topicKey).update('\0').update(narrative).digest('hex')
    const write = digest.writes.then(async () => {
      if (this.host.signal.aborted) return
      if (topicKey === digest.topicPrefix && digest.savedHash === hash) return
      await this.save(digest.session, topicKey, title, narrative)
      if (topicKey === digest.topicPrefix) digest.savedHash = hash
    }).catch((error: unknown) => { this.report(error, 'save') })
    digest.writes = write
    this.host.track(write)
  }

  private async save(session: SessionLike, topicKey: string, title: string, narrative: string): Promise<void> {
    const signal = AbortSignal.any([this.host.signal, AbortSignal.timeout(60_000)])
    const provider = await this.host.provider()
    const stored = await storeObservation(provider, {
      entityName: workspaceEntity(session.header.cwd ?? ''), type: DIGEST_TYPE, title, narrative, topicKey,
      concepts: ['dsh-session', 'automatic-digest'],
    }, signal, 'session digest')
    const database = provider.local || this.config.databasePath !== '' ? this.host.database(provider) : undefined
    if (database !== undefined && !memorixStoredChunk(database, stored.id, stored.project, topicKey, narrative)) throw new Error('Memorix did not persist the complete session digest')
  }

  private report(error: unknown, action: 'save' | 'recall'): void {
    if (this.host.signal.aborted) return
    const message = error instanceof Error ? error.message : String(error)
    const entry = `memory-workspace: automatic memory ${action} failed: ${message}`
    const key = `${action}:${message}`
    if (this.reported.has(key)) this.ctx.logger.info(entry)
    else {
      this.reported.add(key)
      this.ctx.logger.warn(entry)
    }
  }

  private async recall(session: SessionLike): Promise<void> {
    const cwd = session.header.cwd
    if (cwd === undefined || session.header.origin === 'subagent' || this.recalled.has(session.id)) return
    try {
      const provider = await this.host.provider()
      const rows = memorixRecent(this.host.database(provider), {
        entityName: workspaceEntity(cwd), excludeTopicPrefix: `dsh-session:${session.id}:`,
        before: new Date(session.header.createdAt).toISOString(), limit: RECALL_DIGESTS,
      })
      this.recalled.set(session.id, recallText(rows, this.config.memoryCharacters))
    } catch (error) { this.report(error, 'recall') }
  }
}

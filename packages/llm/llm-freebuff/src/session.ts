import { LlmError } from '@deepseek-ai/dsh-llm'
import type { SubprocessTerminalHandle, SubprocessTerminalSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import type { FreebuffAccount } from './auth.ts'
import { bindChat, chatsDirOf, listChats, readChat, rowText, squash, type ChatMessage } from './chat.ts'
import type { FreebuffEnvironment } from './environment.ts'
import { freebuffLaunch } from './launch.ts'
import { renderBlocks, type RenderedBlock } from './markdown.ts'
import { classifyScreen, FreebuffScreen } from './screen.ts'

const COLS = 120
const ROWS = 50
const PASTE_START = '\x1b[200~'
const PASTE_END = '\x1b[201~'
const ESCAPE = '\x1b'

export interface TurnRequest {
  readonly prompt: string
  readonly cwd: string
  readonly chatId: string | undefined
  readonly consumed: string | undefined
  readonly signal: AbortSignal
}

export interface TurnEnd {
  readonly chatId: string
  readonly consumed: string
}

export interface PoolOptions {
  readonly environment: FreebuffEnvironment
  readonly account: FreebuffAccount
  readonly spawnTerminal: (spec: SubprocessTerminalSpawnSpec) => Promise<SubprocessTerminalHandle>
  readonly idleReapMs: () => number
}

interface Live {
  readonly terminal: SubprocessTerminalHandle
  readonly screen: FreebuffScreen
  readonly abort: AbortController
  readonly detach: () => void
  exited: boolean
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = (): void => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    signal?.addEventListener('abort', done, { once: true })
  })
}

class Mutex {
  private tail: Promise<void> = Promise.resolve()

  async acquire(signal: AbortSignal): Promise<() => void> {
    const previous = this.tail
    let release!: () => void
    this.tail = new Promise<void>((resolve) => { release = resolve })
    await previous
    if (signal.aborted) {
      release()
      signal.throwIfAborted()
    }
    return release
  }
}

const SPAWN_MUTEX = new Mutex()

function indexAfter(rows: readonly ChatMessage[], consumed: string | undefined): number {
  if (consumed === undefined) return 0
  const at = rows.findIndex(row => row.id === consumed)
  return at < 0 ? 0 : at + 1
}

function turnRow(rows: readonly ChatMessage[], consumed: string | undefined, prompt: string): number {
  const start = indexAfter(rows, consumed)
  const wanted = squash(prompt)
  const at = rows.slice(start).findIndex(row => row.variant === 'user' && squash(rowText(row)) === wanted)
  return at < 0 ? -1 : start + at
}

function failureOf(row: ChatMessage): string | undefined {
  if (row.variant === 'error') return rowText(row) || 'Freebuff reported an error.'
  if (row.variant === 'ai' && typeof row.userError === 'string' && row.userError.length > 0) return row.userError
  if (row.variant === 'ai' && row.blocks?.some(block => block.type === 'ask-user') === true) {
    return 'Freebuff asked a question that the harness cannot answer. Ask it again with the missing details.'
  }
  return undefined
}

function refusal(rows: readonly ChatMessage[]): string | undefined {
  const failures = rows.map(failureOf)
  const failedAt = failures.findLastIndex(failure => failure !== undefined)
  if (failedAt < 0) return undefined
  const recovered = rows.slice(failedAt + 1).some(row => row.variant === 'ai' && row.isComplete === true && renderBlocks([row]).length > 0)
  return recovered ? undefined : failures[failedAt]
}

export class FreebuffSession {
  chatId: string | undefined
  consumed: string | undefined
  lastUsed = 0
  running = false
  occupied = false
  private live: Live | undefined
  private idle: NodeJS.Timeout | undefined

  constructor(private readonly pool: FreebuffPool) {}

  async *turn(request: TurnRequest): AsyncGenerator<RenderedBlock[], TurnEnd> {
    if (this.running) throw new LlmError('A Freebuff turn is already running for this session.', 'INVALID_REQUEST')
    this.running = true
    clearTimeout(this.idle)
    let finished = false
    try {
      const end = yield* this.drive(request)
      finished = true
      return end
    } finally {
      this.running = false
      this.lastUsed = Date.now()
      if (!finished) {
        if (request.signal.aborted) await this.interrupt()
        else await this.kill()
      }
      this.armIdle()
    }
  }

  async kill(): Promise<void> {
    clearTimeout(this.idle)
    const { live } = this
    this.live = undefined
    this.occupied = false
    if (live === undefined) return
    live.detach()
    live.abort.abort()
    await live.terminal.terminate().catch(() => {})
    await live.terminal.done.catch(() => {})
    live.screen.dispose()
  }

  private armIdle(): void {
    clearTimeout(this.idle)
    if (this.live === undefined) return
    this.idle = setTimeout(() => { void this.kill() }, this.pool.options.idleReapMs())
    this.idle.unref()
  }

  private async interrupt(): Promise<void> {
    const { live } = this
    if (live === undefined) return
    const { timing } = this.pool.options.environment
    this.consumed = readChat(chatsDirOf(this.pool.options.environment.configDir, this.cwd), this.chatId ?? '')?.at(-1)?.id ?? this.consumed
    await live.terminal.write(ESCAPE).catch(() => {})
    const deadline = Date.now() + timing.interruptWaitMs
    while (Date.now() < deadline && !live.exited) {
      await sleep(timing.pollMs)
      if (!classifyScreen(live.screen.text()).busy) return
    }
    await this.kill()
  }

  private cwd = ''

  private async spawn(request: TurnRequest, chatId: string | undefined): Promise<Live> {
    const { environment } = this.pool.options
    this.occupied = true
    try {
      await this.pool.makeRoom(this)
      const executable = await environment.resolveExecutable(request.signal)
      const launch = freebuffLaunch(
        executable,
        [...environment.args, '--cwd', request.cwd, ...chatId === undefined ? [] : ['--continue', chatId]],
        environment.platform,
        environment.comSpec,
      )
      const abort = new AbortController()
      const terminal = await this.pool.options.spawnTerminal({
        argv: launch.argv,
        cwd: request.cwd,
        env: { ...environment.env, ...launch.env },
        rows: ROWS,
        cols: COLS,
        terminalType: 'xterm-256color',
        graceMs: environment.timing.graceMs,
        signal: abort.signal,
      })
      let screen: FreebuffScreen
      try {
        screen = new FreebuffScreen(COLS, ROWS, (data) => { terminal.write(data).catch(() => {}) })
      } catch (error: unknown) {
        abort.abort()
        await terminal.terminate().catch(() => {})
        throw error
      }
      terminal.output.setEncoding('utf8')
      const onOutput = (chunk: string): void => { screen.write(chunk) }
      const onError = (): void => {}
      terminal.output.on('data', onOutput)
      terminal.output.on('error', onError)
      const live: Live = {
        terminal,
        screen,
        abort,
        exited: false,
        detach: () => {
          terminal.output.off('data', onOutput)
          terminal.output.off('error', onError)
        },
      }
      const exited = (): void => { live.exited = true }
      terminal.done.then(exited, exited)
      return live
    } catch (error: unknown) {
      this.occupied = false
      throw error
    }
  }

  private async waitReady(request: TurnRequest, live: Live): Promise<void> {
    const { timing } = this.pool.options.environment
    const deadline = Date.now() + timing.startupTimeoutMs
    let answered = false
    for (;;) {
      request.signal.throwIfAborted()
      if (live.exited) throw new LlmError('Freebuff exited before it was ready.', 'STREAM_CLOSED')
      const state = classifyScreen(live.screen.text())
      if (state.loginRequired) await this.signedOut()
      if (state.trustPrompt) {
        if (!answered) {
          answered = true
          await live.terminal.write('n\r')
        }
      } else if (state.blocker !== undefined) {
        throw new LlmError(`Freebuff is waiting on the prompt "${state.blocker}".`, 'UNKNOWN')
      } else if (state.ready && !state.busy) {
        return
      }
      if (Date.now() >= deadline) throw new LlmError(`Freebuff was not ready within ${String(timing.startupTimeoutMs)} ms.`, 'UNKNOWN')
      await sleep(timing.pollMs, request.signal)
    }
  }

  private async signedOut(): Promise<never> {
    await this.pool.options.account.signedOut().catch(() => {})
    throw new LlmError('Freebuff is signed out. Sign in with Freebuff in the settings.', 'ACCOUNT_SIGN_IN_REQUIRED')
  }

  private async submit(request: TurnRequest, live: Live): Promise<void> {
    await live.terminal.write(`${PASTE_START}${request.prompt}${PASTE_END}`)
    await sleep(this.pool.options.environment.timing.pasteSettleMs, request.signal)
    request.signal.throwIfAborted()
    await live.terminal.write('\r')
  }

  private async bind(request: TurnRequest, chatsDir: string, before: ReadonlySet<string>): Promise<string> {
    const { timing } = this.pool.options.environment
    const deadline = Date.now() + timing.startupTimeoutMs
    for (;;) {
      const found = bindChat(chatsDir, before, request.prompt)
      if (found !== undefined) return found
      request.signal.throwIfAborted()
      if (Date.now() >= deadline) throw new LlmError('Freebuff did not record the prompt in a chat.', 'UNKNOWN')
      await sleep(timing.pollMs, request.signal)
    }
  }

  private async *drive(request: TurnRequest): AsyncGenerator<RenderedBlock[], TurnEnd> {
    const { environment } = this.pool.options
    const { timing } = environment
    const chatsDir = chatsDirOf(environment.configDir, request.cwd)
    this.cwd = request.cwd
    if (this.live?.exited === true) await this.kill()
    if (request.chatId !== undefined && this.chatId !== request.chatId) {
      await this.kill()
      this.chatId = request.chatId
      this.consumed = request.consumed
    }
    let chatId = this.chatId
    const rowsOf = (): ChatMessage[] => readChat(chatsDir, chatId as string) ?? []
    const consumedAt = (): string | undefined => {
      const rows = rowsOf()
      return indexAfter(rows, request.consumed) > indexAfter(rows, this.consumed) ? request.consumed : this.consumed
    }
    const consumed = chatId === undefined ? undefined : consumedAt()
    const release = chatId === undefined ? await SPAWN_MUTEX.acquire(request.signal) : undefined
    let live: Live
    let submitted = false
    try {
      live = this.live ?? await this.spawn(request, chatId)
      this.live = live
      await this.waitReady(request, live)
      const before = new Set(chatId === undefined ? listChats(chatsDir) : [])
      if (chatId === undefined || turnRow(rowsOf(), consumed, request.prompt) < 0) {
        await this.submit(request, live)
        submitted = true
      }
      if (chatId === undefined) {
        chatId = await this.bind(request, chatsDir, before)
        this.chatId = chatId
      }
    } finally {
      release?.()
    }
    const startedAt = Date.now()
    let sawBusy = false
    let lastBusyAt = startedAt
    let shown = ''
    for (;;) {
      request.signal.throwIfAborted()
      if (live.exited) throw new LlmError('Freebuff exited before the turn finished.', 'STREAM_CLOSED')
      const state = classifyScreen(live.screen.text(), request.prompt)
      const now = Date.now()
      if (state.busy) {
        sawBusy = true
        lastBusyAt = now
      }
      const quiet = !state.busy && now - lastBusyAt >= timing.quietMs
      const rows = rowsOf()
      const at = turnRow(rows, consumed, request.prompt)
      const tail = at < 0 ? [] : rows.slice(at + 1)
      const failure = quiet ? refusal(tail) : undefined
      if (failure !== undefined) throw new LlmError(failure, 'UNKNOWN')
      const blocks = renderBlocks(tail)
      const key = JSON.stringify(blocks)
      if (key !== shown) {
        shown = key
        yield blocks
      }
      const last = tail.filter(row => row.variant === 'ai').at(-1)
      if (at >= 0 && quiet && (last?.isComplete === true || ((sawBusy || !submitted) && state.ready))) {
        if (blocks.length === 0) throw new LlmError('Freebuff finished without an answer.', 'EMPTY_RESPONSE')
        const end = { chatId: chatId, consumed: String(rows.at(-1)?.id) }
        this.consumed = end.consumed
        return end
      }
      if (!state.busy) {
        if (state.loginRequired) await this.signedOut()
        if (state.blocker !== undefined) throw new LlmError(`Freebuff is waiting on the prompt "${state.blocker}".`, 'UNKNOWN')
      }
      if (!sawBusy && at < 0 && now - startedAt >= timing.startupTimeoutMs) {
        throw new LlmError('Freebuff did not start working on the prompt.', 'UNKNOWN')
      }
      await sleep(timing.pollMs, request.signal)
    }
  }
}

export class FreebuffPool {
  private readonly sessions = new Map<string, FreebuffSession>()

  constructor(readonly options: PoolOptions) {}

  session(id: string): FreebuffSession {
    let session = this.sessions.get(id)
    if (session === undefined) {
      session = new FreebuffSession(this)
      this.sessions.set(id, session)
    }
    return session
  }

  async makeRoom(requester: FreebuffSession): Promise<void> {
    const limit = this.options.environment.timing.maxTerminals
    for (;;) {
      const occupied = [...this.sessions.values()].filter(session => session !== requester && session.occupied)
      if (occupied.length < limit) return
      const victim = occupied.filter(session => !session.running).sort((a, b) => a.lastUsed - b.lastUsed)[0]
      if (victim === undefined) {
        throw new LlmError(`Freebuff already has ${String(limit)} sessions running. Wait for one to finish.`, 'UNKNOWN')
      }
      await victim.kill()
    }
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.sessions.values()].map(session => session.kill()))
    this.sessions.clear()
  }
}

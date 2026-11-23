import { randomUUID } from 'node:crypto'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import {
  runTimeLimit,
  settleRunResult,
  subprocessRunHandle,
  type SubagentResult,
  type SubagentRun,
  type SubagentStartRequest,
  type SubagentStopReason,
} from '@deepseek-ai/dsh-subagent'
import type {
  SubprocessOutcome,
  SubprocessTerminalHandle,
  SubprocessTerminalSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'
import { FreebuffNotLoggedInError, FreebuffRunFailure } from './errors.ts'
import { classifyScreen, FreebuffScreen, screenAnswer, type ScreenState } from './screen.ts'
import { findChatFile, readTranscript } from './transcript.ts'

export const DEFAULT_DISPOSE_GRACE_MS = 3_000
export const DEFAULT_STARTUP_TIMEOUT_MS = 60_000
export const DEFAULT_IDLE_MS = 2_500
export const DEFAULT_TIMEOUT_MS = 1_800_000

const COLS = 120
const ROWS = 50
const POLL_MS = 250
const PASTE_SETTLE_MS = 150
const PASTE_START = '\x1b[200~'
const PASTE_END = '\x1b[201~'
const SCREEN_TAIL_ROWS = 12

export interface FreebuffRunSpec {
  readonly cwd: string
  readonly executable: string
  readonly args: readonly string[]
  readonly env: Record<string, string>
  readonly trustAgents: boolean
  readonly startupTimeoutMs: number
  readonly idleMs: number
  readonly timeoutMs: number
  readonly disposeGraceMs: number
  readonly configDir: string
  readonly spawnTerminal: (spec: SubprocessTerminalSpawnSpec) => Promise<SubprocessTerminalHandle>
  readonly onError?: (error: Error, stopReason: SubagentStopReason) => void
}

export function taskText(prompt: readonly ContentBlock[]): string {
  const texts: string[] = []
  for (const block of prompt) {
    if (block.type !== 'text') {
      throw new Error('subagent-freebuff: the one-shot task must contain only text blocks')
    }
    texts.push(block.text)
  }
  const task = texts.join('\n\n').replaceAll('\r\n', '\n').replace(/[^\P{Cc}\n\t]/gu, '').trim()
  if (task.length === 0) throw new Error('subagent-freebuff: the one-shot task must not be empty')
  return task
}

function thrown(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = (): void => {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    signal.addEventListener('abort', done, { once: true })
  })
}

function exitDetail(outcome: SubprocessOutcome): string {
  const fields = [`exit code ${String(outcome.exitCode)}`]
  if (outcome.signal !== null) fields.push(`signal ${outcome.signal}`)
  return fields.join(', ')
}

export async function startFreebuffRun(
  request: SubagentStartRequest,
  spec: FreebuffRunSpec,
): Promise<SubagentRun> {
  const task = taskText(request.prompt)
  if (request.signal.aborted) throw new Error('subagent-freebuff: request was aborted before startup')

  const startedAt = Date.now()
  const argv = [spec.executable, ...spec.args, ...spec.trustAgents ? ['--trust-agents'] : []]
  let terminal: SubprocessTerminalHandle
  try {
    terminal = await spec.spawnTerminal({
      argv,
      cwd: spec.cwd,
      env: spec.env,
      rows: ROWS,
      cols: COLS,
      terminalType: 'xterm-256color',
      graceMs: spec.disposeGraceMs,
      signal: request.signal,
    })
  } catch (error: unknown) {
    throw new FreebuffRunFailure('startup', 'process', 'the Freebuff terminal could not be started', undefined, error)
  }

  const screen = new FreebuffScreen(COLS, ROWS, (data) => {
    terminal.write(data).catch(() => {})
  })
  terminal.output.setEncoding('utf8')
  const onOutput = (chunk: string): void => { screen.write(chunk) }
  const onOutputError = (): void => {}
  terminal.output.on('data', onOutput)
  terminal.output.on('error', onOutputError)

  const screenTail = (): string => screen.text().split('\n').slice(-SCREEN_TAIL_ROWS).join('\n')
  const failure = (
    stage: FreebuffRunFailure['stage'],
    category: FreebuffRunFailure['category'],
    detail?: string,
  ): FreebuffRunFailure => new FreebuffRunFailure(stage, category, detail, screenTail())

  let stopping = false
  let termination: Promise<void> | undefined
  const terminate = (): Promise<void> => {
    stopping = true
    termination ??= terminal.terminate()
    return termination
  }
  const release = async (): Promise<void> => {
    try {
      await terminate()
      await terminal.done.catch(() => {})
    } catch (error: unknown) {
      throw new FreebuffRunFailure('teardown', 'unknown', undefined, undefined, error)
    } finally {
      terminal.output.off('data', onOutput)
      terminal.output.off('error', onOutputError)
      screen.dispose()
    }
  }

  const processFailure: Promise<never> = terminal.done.then<never>(
    (outcome) => {
      if (stopping) return new Promise<never>(() => {})
      throw failure('process', 'process', `Freebuff exited before the run finished (${exitDetail(outcome)})`)
    },
    (error: unknown) => {
      throw new FreebuffRunFailure('process', 'process', 'the Freebuff terminal failed', screenTail(), error)
    },
  )
  processFailure.catch(() => {})

  const runAbort = new AbortController()
  const requestCancel = (): void => {
    if (runAbort.signal.aborted) return
    runAbort.abort(new Error('subagent-freebuff: run cancelled locally'))
    terminate().catch(() => {})
  }
  const onAbort = (): void => { requestCancel() }
  request.signal.addEventListener('abort', onAbort, { once: true })

  const pause = async (ms: number): Promise<void> => {
    await Promise.race([sleep(ms, runAbort.signal), processFailure])
    runAbort.signal.throwIfAborted()
  }

  const waitReady = async (): Promise<void> => {
    const deadline = Date.now() + spec.startupTimeoutMs
    let answeredTrust = false
    for (;;) {
      const state = classifyScreen(screen.text())
      if (state.loginRequired) throw new FreebuffNotLoggedInError('login screen shown by Freebuff')
      if (state.trustPrompt) {
        if (!answeredTrust) {
          answeredTrust = true
          await terminal.write('n\r')
        }
      } else if (state.blocker !== undefined) {
        throw failure('startup', 'blocked', `Freebuff is waiting on the prompt "${state.blocker}"`)
      } else if (state.ready && !state.busy) {
        return
      }
      if (Date.now() >= deadline) {
        throw failure('startup', 'limit', `Freebuff was not ready within startupTimeoutMs (${spec.startupTimeoutMs} ms)`)
      }
      await pause(POLL_MS)
    }
  }

  try {
    await Promise.race([waitReady(), processFailure])
  } catch (error: unknown) {
    request.signal.removeEventListener('abort', onAbort)
    const cancelled = runAbort.signal.aborted || request.signal.aborted
    const startupFailure = thrown(error)
    spec.onError?.(startupFailure, 'error')
    try {
      await release()
    } catch (cleanupError: unknown) {
      throw new AggregateError(
        [startupFailure, cleanupError],
        `${startupFailure.message}; ${thrown(cleanupError).message}`,
      )
    }
    if (cancelled) throw new Error('subagent-freebuff: request was aborted before run publication')
    throw startupFailure
  }

  let output: readonly ContentBlock[] = []
  let diagnostic: string | undefined

  const turn = async (): Promise<SubagentResult> => {
    await terminal.write(`${PASTE_START}${task}${PASTE_END}`)
    await pause(PASTE_SETTLE_MS)
    await terminal.write('\r')
    const submittedAt = Date.now()
    let sawBusy = false
    let lastBusyAt = submittedAt
    let chatFile: string | undefined
    for (;;) {
      const screenText = screen.text()
      const state: ScreenState = classifyScreen(screenText)
      if (!sawBusy) {
        if (state.loginRequired) throw new FreebuffNotLoggedInError('login screen shown by Freebuff')
        if (state.blocker !== undefined) {
          throw failure('turn', 'blocked', `Freebuff is waiting on the prompt "${state.blocker}"`)
        }
      }
      const now = Date.now()
      if (state.busy) {
        sawBusy = true
        lastBusyAt = now
      }
      chatFile ??= findChatFile(spec.configDir, spec.cwd, startedAt)
      const transcript = chatFile === undefined ? undefined : readTranscript(chatFile)
      if (transcript?.error !== undefined) {
        spec.onError?.(failure('turn', 'product-error', transcript.error), 'error')
        throw failure('turn', 'product-error', 'Freebuff reported an error while working')
      }
      const quiet = !state.busy && now - lastBusyAt >= spec.idleMs
      if (quiet && ((sawBusy && state.ready) || transcript?.complete === true)) {
        const answer = transcript?.complete === true ? transcript.answer : screenAnswer(screenText, task)
        if (answer.length === 0) throw failure('turn', 'invalid-result', 'Freebuff finished without an answer')
        output = [{ type: 'text', text: answer }]
        return { output, stopReason: 'completed' }
      }
      if (!sawBusy && transcript === undefined && now - submittedAt >= spec.startupTimeoutMs) {
        throw failure('turn', 'invalid-result', 'Freebuff did not start working on the task')
      }
      await pause(POLL_MS)
    }
  }

  const limit = runTimeLimit(
    spec.timeoutMs,
    requestCancel,
    () => failure('turn', 'limit', `exceeded timeoutMs (${spec.timeoutMs} ms)`),
  )
  const result: Promise<SubagentResult> = settleRunResult({
    attempt: async () => {
      const attempt = turn()
      attempt.catch(() => {})
      try {
        const settled = await Promise.race([attempt, processFailure, limit.expired])
        terminate().catch(() => {})
        return settled
      } catch (error: unknown) {
        if (error instanceof FreebuffRunFailure || error instanceof FreebuffNotLoggedInError) {
          diagnostic = error.message
        }
        throw error
      } finally {
        limit.clear()
      }
    },
    collectOutput: () => output,
    collectDiagnostic: () => diagnostic,
    cancelled: () => runAbort.signal.aborted && !limit.timedOut(),
    onError: (error, stopReason) => {
      spec.onError?.(error, stopReason)
    },
    signal: request.signal,
    onAbort,
  })

  return subprocessRunHandle({
    id: brandString<SessionId>(randomUUID()),
    result,
    signal: request.signal,
    onAbort,
    requestCancel,
    teardown: release,
  })
}

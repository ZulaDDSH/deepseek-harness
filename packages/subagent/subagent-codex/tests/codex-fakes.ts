/**
 * Scripted Codex app-server peers and expected protocol facts shared by the Codex provider specs.
 *
 * @module @deepseek-ai/dsh-subagent-codex/tests/codex-fakes
 */

import { PassThrough } from 'node:stream'
import type { SubprocessHandle, SubprocessOutcome } from '@deepseek-ai/dsh-subprocess'
import { vi } from 'vitest'

export type JsonObject = Record<string, unknown>

export async function nextTask(): Promise<void> {
  await new Promise<void>((resolve) => { setImmediate(resolve) })
}

export class ProtocolPeer {
  private buffer = ''
  private readonly frames: JsonObject[] = []
  private readonly wakeups = new Set<() => void>()

  constructor(
    input: PassThrough,
    private readonly output: PassThrough,
  ) {
    input.on('data', (chunk: Buffer | string) => {
      this.buffer += chunk.toString()
      for (;;) {
        const newline = this.buffer.indexOf('\n')
        if (newline < 0) break
        const line = this.buffer.slice(0, newline)
        this.buffer = this.buffer.slice(newline + 1)
        if (line.trim().length > 0) this.frames.push(JSON.parse(line) as JsonObject)
      }
      for (const wake of this.wakeups) wake()
      this.wakeups.clear()
    })
  }

  async next(predicate: (frame: JsonObject) => boolean): Promise<JsonObject> {
    for (;;) {
      const index = this.frames.findIndex(predicate)
      if (index >= 0) return this.frames.splice(index, 1)[0]!
      await new Promise<void>((resolve) => { this.wakeups.add(resolve) })
    }
  }

  nextMethod(method: string): Promise<JsonObject> {
    return this.next(frame => frame.method === method)
  }

  nextResponse(id: unknown): Promise<JsonObject> {
    return this.next(frame => frame.id === id && frame.method === undefined)
  }

  send(...frames: readonly JsonObject[]): void {
    this.output.write(`${frames.map(frame => JSON.stringify(frame)).join('\n')}\n`)
  }

  respond(requestFrame: JsonObject, result: unknown): void {
    this.send({ id: requestFrame.id, result })
  }
}

export interface FakeChildOptions {
  readonly exitOnTerminate?: boolean
  readonly doneError?: Error
  readonly waitForExitError?: Error
}

export interface FakeChild {
  readonly handle: SubprocessHandle
  readonly peer: ProtocolPeer
  readonly fromChild: PassThrough
  readonly toChild: PassThrough
  readonly stderr: PassThrough
  readonly settle: (outcome?: SubprocessOutcome) => void
  readonly fail: (error: Error) => void
  readonly setStderr: (text: string) => void
  readonly terminate: () => void
  readonly waitForExit: (signal?: AbortSignal) => Promise<boolean>
}

export function fakeChild(options: FakeChildOptions = {}): FakeChild {
  const fromChild = new PassThrough()
  const toChild = new PassThrough()
  const stderr = new PassThrough()
  const peer = new ProtocolPeer(toChild, fromChild)
  let exited = false
  let resolveDone!: (outcome: SubprocessOutcome) => void
  let rejectDone!: (error: Error) => void
  const done = new Promise<SubprocessOutcome>((resolve, reject) => {
    resolveDone = resolve
    rejectDone = reject
  })
  const settle = (
    outcome: SubprocessOutcome = { exitCode: 0, signal: null },
  ): void => {
    if (exited) return
    exited = true
    resolveDone(outcome)
  }
  const fail = (error: Error): void => {
    if (exited) return
    exited = true
    rejectDone(error)
  }
  if (options.doneError !== undefined) fail(options.doneError)
  const terminate = vi.fn(() => {
    if (options.exitOnTerminate !== false) settle()
  })
  const waitForExit = vi.fn(async (signal?: AbortSignal) => {
    if (options.waitForExitError !== undefined) {
      throw options.waitForExitError
    }
    if (exited) return true
    if (signal === undefined) {
      await done.catch(() => {})
      return true
    }
    return await new Promise<boolean>((resolve) => {
      const onAbort = (): void => { resolve(false) }
      signal.addEventListener('abort', onAbort, { once: true })
      void done.then(
        () => {
          signal.removeEventListener('abort', onAbort)
          resolve(true)
        },
        () => {
          signal.removeEventListener('abort', onAbort)
          resolve(true)
        },
      )
    })
  })
  const handle: SubprocessHandle = {
    control: undefined,
    stdin: toChild,
    stdout: fromChild,
    stderr,
    collected: {},
    done,
    terminate,
    waitForExit,
  }
  return {
    handle,
    peer,
    fromChild,
    toChild,
    stderr,
    settle,
    fail,
    setStderr: (text: string): void => { stderr.write(text) },
    terminate,
    waitForExit,
  }
}

export function agentMessage(
  text: unknown,
  phase: unknown,
  turnId = 'turn-1',
  threadId = 'thread-1',
): JsonObject {
  return {
    method: 'item/completed',
    params: {
      threadId,
      turnId,
      item: { type: 'agentMessage', text, phase },
    },
  }
}

export function turnCompleted(
  status: unknown,
  turnId = 'turn-1',
  threadId = 'thread-1',
  error: unknown = null,
): JsonObject {
  return {
    method: 'turn/completed',
    params: {
      threadId,
      turn: { id: turnId, status, error },
    },
  }
}

export function expectedFailureDiagnostic(
  stage: 'initialize' | 'thread-start' | 'turn-start' | 'turn' | 'process' | 'teardown',
  category: string,
  options: {
    readonly httpStatus?: number
    readonly outcome?: Partial<SubprocessOutcome>
  } = {},
): string {
  const fields = [
    'product: Codex',
    `stage: ${stage}`,
    `category: ${category}`,
  ]
  if (options.httpStatus !== undefined) {
    fields.push(`HTTP status: ${options.httpStatus}`)
  }
  if (
    options.outcome?.exitCode !== null
    && options.outcome?.exitCode !== undefined
  ) {
    fields.push(`exit code: ${options.outcome.exitCode}`)
  }
  if (
    options.outcome?.signal !== null
    && options.outcome?.signal !== undefined
  ) {
    fields.push(`signal: ${options.outcome.signal}`)
  }
  return `Product subagent failure (${fields.join('; ')})`
}

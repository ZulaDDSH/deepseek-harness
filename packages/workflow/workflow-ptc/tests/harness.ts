/** Scripted-provider harness shared by the workflow-ptc specs: a real SubagentRuntime, a manual or auto stub, and the PTC engine. */

import { vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import type { SubagentCapabilities, SubagentProvider, SubagentResult, SubagentRun, SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import type { WorkflowMeta, WorkflowResult } from '@deepseek-ai/dsh-workflow'
import PtcWorkflowEngine, { type Config } from '../src/index.ts'
import { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'

import { fakeParent, mountPtcRuntime } from './setup.ts'

/** Bound observations of process startup and host callbacks on shared CI runners. */
export function waitFor(assertion: () => void, timeout = 60_000): Promise<void> {
  return vi.waitFor(assertion, { timeout, interval: 50 })
}

/** One controllable child run: the test (or auto mode) settles it. */
export interface ControlledRun {
  request: SubagentStartRequest
  /** Fulfill the provider's async start with a published child. */
  publish(): void
  /** Reject the provider's async start before ownership transfer. */
  rejectStart(error: unknown): void
  settle(result: SubagentResult): void
  rejectResult(error: unknown): void
  cancelled: string | undefined
  disposed: boolean
  disposeCalls: number
}

/**
 * A scripted in-test provider over the REAL SubagentRuntime registry: `auto`
 * settles each run via the reply function on a microtask; `manual` piles runs
 * up in `runs` for the test to settle. A run aborts (settles `aborted`) when
 * the request signal fires, like the real in-process backends.
 */
export class StubProvider implements SubagentProvider {
  readonly capabilities: SubagentCapabilities = {
    agentOptions: true,
    outputSchema: true,
    depthLimit: true,
    toolFilter: true,
    persona: false,
  }
  readonly inheritsParentContext = false
  readonly runs: ControlledRun[] = []

  constructor(
    readonly name: string,
    private readonly reply?: (request: SubagentStartRequest, index: number) => SubagentResult,
    private readonly disposeDelayMs = 0,
    private readonly deferStart = false,
    private readonly onAbortString?: (reason: string | undefined, index: number) => void,
    private readonly onSignalAbort?: (reason: unknown, index: number) => void,
  ) {}

  async start(request: SubagentStartRequest): Promise<SubagentRun> {
    const startGate = Promise.withResolvers<undefined>()
    const terminal = Promise.withResolvers<SubagentResult>()
    terminal.promise.catch(() => { /* provider owns early settlement until publication */ })
    let published = false
    const controlled: ControlledRun = {
      request,
      publish: () => { published = true; startGate.resolve(undefined) },
      rejectStart: (error) => { startGate.reject(error) },
      settle: (result) => { terminal.resolve(result) },
      rejectResult: (error) => { terminal.reject(error) },
      cancelled: undefined,
      disposed: false,
      disposeCalls: 0,
    }
    this.runs.push(controlled)
    const index = this.runs.length - 1
    request.signal.addEventListener('abort', () => {
      controlled.cancelled = String(request.signal.reason ?? 'cancelled')
      this.onAbortString?.(String(request.signal.reason ?? 'cancelled'), index)
      this.onSignalAbort?.(request.signal.reason, index)
      if (published) terminal.resolve({ output: [], stopReason: 'aborted' })
      else startGate.reject(new Error('child start aborted before publication'))
    }, { once: true })
    if (!this.deferStart) controlled.publish()
    if (this.reply) {
      const reply = this.reply
      queueMicrotask(() => { terminal.resolve(reply(request, index)) })
    }
    try {
      await startGate.promise
    } catch (error: unknown) {
      controlled.disposeCalls += 1
      controlled.disposed = true
      throw error
    }
    if (request.signal.aborted) throw new Error('child start aborted before publication')
    return {
      id: SessionId(`stub-child-${index}`),
      localAgent: undefined,
      result: terminal.promise,
      dispose: () => {
        controlled.disposeCalls += 1
        if (this.disposeDelayMs === 0) {
          controlled.disposed = true
          return Promise.resolve()
        }
        return new Promise<void>((resolve) => {
          setTimeout(() => {
            controlled.disposed = true
            resolve()
          }, this.disposeDelayMs)
        })
      },
    }
  }
}

/** Text-reply helper for auto providers. */
export function text(reply: string): SubagentResult {
  return { output: [{ type: 'text', text: reply }], stopReason: 'completed' }
}

export interface SetupOptions {
  config?: Config
  subagentConfig?: { maxActiveSubagents: number }
  reply?: (request: SubagentStartRequest, index: number) => SubagentResult
  manual?: boolean
  disposeDelayMs?: number
  deferStart?: boolean
  onChildAbortString?: (reason: string | undefined, index: number) => void
  onChildSignalAbort?: (reason: unknown, index: number) => void
}

export async function setup(options?: SetupOptions) {
  const ctx = new Context()
  await ctx.plugin(SessionProjectionRegistry)
  await mountPtcRuntime(ctx)
  // The one-shot capacity pool exists only while an agents service is injected.
  if (options?.subagentConfig !== undefined) ctx.provide('agents', {} as never)
  await ctx.plugin(SubagentRuntime, { ...options?.subagentConfig })
  const provider = new StubProvider(
    'stub',
    options?.manual ? undefined : options?.reply ?? (() => text('stub reply')),
    options?.disposeDelayMs ?? 0,
    options?.deferStart ?? false,
    options?.onChildAbortString,
    options?.onChildSignalAbort,
  )
  ctx.subagents.registerProvider(provider)
  // A fixed concurrency ceiling: the auto-resolved default is machine-derived
  // (cores - 2, floored at 1), so tests that expect N children in flight
  // would wedge on small CI runners.
  const engineFiber = await ctx.plugin(PtcWorkflowEngine, { provider: 'stub', maxConcurrentAgents: 8, ...options?.config })
  return { ctx, provider, parent: fakeParent(ctx), engineFiber }
}

/** The standard test meta plus a body, spread into a start request. */
export function scripted(body: string, metaExtra?: Partial<WorkflowMeta>): { script: string; meta: WorkflowMeta } {
  return { script: body, meta: { name: 'test-flow', description: 'a test workflow', ...metaExtra } }
}

/** Start + await one run, disposing on the way out. */
export async function run(
  ctx: Context, parent: Agent, source: { script: string; meta: WorkflowMeta }, args?: unknown,
): Promise<WorkflowResult> {
  const handle = ctx.workflowEngine.start({ ...source, parent, ...args !== undefined ? { args } : {} })
  try {
    return await handle.result
  } finally {
    await handle.dispose()
  }
}

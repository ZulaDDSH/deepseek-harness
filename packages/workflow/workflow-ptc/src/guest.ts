/** Executes one workflow VM inside the mounted PTC runtime's Node process. */

import type { WorkflowResult } from '@deepseek-ai/dsh-workflow'
import type { WorkflowGuestHost, WorkflowProgress } from './guest-types.ts'
import { renderThrown } from './realm.ts'
import { WorkflowExecution } from './runtime.ts'
import type { ExecutionObserver } from './runtime.ts'
import type { ChildPort } from './types.ts'

const MAX_BATCH_EVENTS = 256
const MAX_BATCH_CHARS = 65_536
const MAX_QUEUED_EVENTS = 4096
const MAX_QUEUED_CHARS = 1_048_576
const MAX_LOG_CHARS = 8192

/**
 * Run a workflow with one progress batch in flight. Drain progress before child
 * disposal and the terminal result; PTC and the host own cancellation and cleanup.
 * @param host - JSON callbacks owned by this workflow run.
 * @returns The script result after progress delivery; initialization failures reject.
 */
export async function runWorkflowGuest(host: WorkflowGuestHost): Promise<WorkflowResult> {
  const init = await host.begin({})
  let queued: { event: WorkflowProgress; size: number }[] = []
  let queuedChars = 0
  let dropped = 0
  let inFlight: Promise<void> | undefined
  let progressError: string | undefined
  const flush = (): void => {
    if (inFlight !== undefined) return
    if (dropped > 0) {
      const event: WorkflowProgress = { type: 'log', message: `${dropped} progress events dropped: the progress queue was full` }
      queued.push({ event, size: JSON.stringify(event).length })
      dropped = 0
    }
    if (queued.length === 0) return
    let count = 0
    let chars = 0
    while (count < queued.length && count < MAX_BATCH_EVENTS && (count === 0 || chars + queued[count]!.size <= MAX_BATCH_CHARS)) {
      chars += queued[count]!.size
      count += 1
    }
    const batch = queued.splice(0, count).map(entry => entry.event)
    queuedChars -= chars
    inFlight = host.progress(batch).then(
      () => { inFlight = undefined; flush() },
      (error: unknown) => {
        progressError = renderThrown(error)
        queued = []
        queuedChars = 0
        inFlight = undefined
      },
    )
  }
  const send = (event: WorkflowProgress): void => {
    if (progressError !== undefined) return
    const size = JSON.stringify(event).length
    if ((event.type === 'phase' || event.type === 'log') && (queued.length >= MAX_QUEUED_EVENTS || queuedChars + size > MAX_QUEUED_CHARS)) {
      dropped += 1
      return
    }
    queued.push({ event, size })
    queuedChars += size
    // The first batch reaches the host before a synchronous script can seize its loop.
    flush()
  }
  const drain = async (): Promise<void> => {
    while (inFlight !== undefined) await inFlight
  }
  const observer: ExecutionObserver = {
    phase: (title) => { send({ type: 'phase', title }) },
    log: (message) => { send({ type: 'log', message: message.length > MAX_LOG_CHARS ? `${message.slice(0, MAX_LOG_CHARS)}… [truncated]` : message }) },
    agentStart: (info) => { send({ type: 'agent-start', info }) },
    agentEnd: (info) => { send({ type: 'agent-end', info }) },
  }
  const children: ChildPort = {
    async startAgent(request) {
      const { callId, childId } = await host.startChild(request)
      const result = host.childResult({ callId })
      // A dropped agent() call must not turn a child failure into an unhandled rejection.
      void result.catch(() => {})
      return {
        id: childId,
        result,
        async dispose() {
          // Start observers must receive the child while its host registration is still live.
          await drain()
          await host.disposeChild({ callId })
        },
      }
    },
  }
  const execution = new WorkflowExecution(init.meta, init.body, init.args, init.limits, observer, children)
  const result = await execution.drive()
  await drain()
  return progressError === undefined ? result : {
    value: null,
    stopReason: 'error',
    error: progressError,
    agentsStarted: result.agentsStarted,
  }
}

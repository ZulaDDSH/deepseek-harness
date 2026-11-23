/** Host timer over standalone tasks; target Session activation is a delivery operation. */
import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContextFormed } from '@deepseek-ai/dsh-llm'
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'schedule': { kind: 'schedule' } & ContextFormed
  }
}
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId as SessionIdType } from '@deepseek-ai/dsh-session/types'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionPersistenceNotFoundError } from '@deepseek-ai/dsh-session-persistence'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-session-title'
import type {} from '@deepseek-ai/dsh-workspace'
import {
  isRecurringScheduleRecord, MIN_EVERY_INTERVAL_SECONDS, renderRecurringReminderBatchFraming, renderReminderFraming,
  resolveRecurringOccurrence, type RecurringOccurrence,
} from './domain.ts'
import { formatScheduleLocalTime } from './domain.ts'
import { appendDelivery } from './delivery-history.ts'
import type { ScheduleTask } from './storage.ts'
import type { DeliveryRetentionBounds, ScheduleDeliveryReceipt, ScheduleId, ScheduleSessionCreateSpec } from './types.ts'

/** Largest delay Node timers represent without clamping. */
export const MAX_TIMER_DELAY_MS = 2_147_483_647

const RETRY_BASE_MS = 5_000
const RETRY_MAX_MS = 300_000

export const DELIVERY_STEP_TIMEOUT_MS = 120_000

const STOP_FLUSH_GRACE_MS = 5_000

/** Fixed per-task delivery floor interval, timed or manual, of a target other than `new`; it matches the shortest recurrence spacing. */
export const MIN_DELIVERY_INTERVAL_MS = MIN_EVERY_INTERVAL_SECONDS * 1_000

class DeliveryStepAbandonedError extends Error {}

/** Resolved deployment limits of one runtime. */
export interface ScheduleRuntimeLimits {
  /** Retention window and record cap applied on each delivery commit. */
  readonly retention: DeliveryRetentionBounds
  /** Delivery floor interval of one task whose every delivery creates a Session. */
  readonly newSessionIntervalMs: number
}

/** Target Session of one delivery and its live Agent. */
interface DeliveryTarget {
  readonly sessionId: SessionIdType
  readonly agent: Agent
}

interface EnqueuedReminder {
  readonly agent: Agent
  readonly held: readonly ScheduleId[]
  readonly messageId: ScheduleDeliveryReceipt['messageId']
  readonly execution: Promise<void> | undefined
}

interface ResolvedTarget {
  readonly target: DeliveryTarget
  readonly task: ScheduleTask
}

interface StagedMember {
  readonly task: ScheduleTask
  readonly occurrence: RecurringOccurrence
}

/**
 * Return the Session whose due recurring tasks share one message.
 * @param task - Due task.
 * @returns Target Session of a recurring `session` task, or undefined for a task delivered alone.
 */
function batchSessionOf(task: ScheduleTask): SessionIdType | undefined {
  const { target, record } = task
  return target.kind === 'session' && isRecurringScheduleRecord(record)
    ? target.sessionId
    : undefined
}

/** Owns at most one timer across recomputations; delivery and management share the serialized operation. */
export class ScheduleRuntime {
  private timer: ReturnType<typeof setTimeout> | undefined
  private running: Promise<void> | undefined
  private readonly executing = new Set<ScheduleId>()
  private readonly stop = new AbortController()
  private readonly manual = new Set<Promise<unknown>>()
  private stopping = false
  private requested = false
  private failureStreak = 0

  /**
   * @param ctx - Host services used to resume and enqueue.
   * @param tasks - Current durable tasks.
   * @param transact - Serialize delivery against management writes.
   * @param commit - Persist one task value and publish its change; delivery commits status, target, and receipt together.
   * @param changed - Publish a change that has no task write, such as an execution reaching whole-agent idle.
   * @param limits - Resolved retention and new-Session admission limits.
   * @param resolveAgent - Host fallback after embedding activation handlers delegate.
   */
  constructor(
    private readonly ctx: Context,
    private readonly tasks: () => readonly ScheduleTask[],
    private readonly transact: <T>(work: () => Promise<T>) => Promise<T>,
    private readonly commit: (task: ScheduleTask) => Promise<void>,
    private readonly changed: () => void,
    private readonly limits: ScheduleRuntimeLimits,
    private readonly resolveAgent: (sessionId: SessionIdType) => Promise<Agent>,
  ) {}

  /**
   * Recompute the nearest obligation after startup or a durable change.
   * Dispatch failures are logged; refused admission does not retry automatically.
   */
  requestDrive(): void {
    if (this.stopping) return
    this.requested = true
    this.clearTimer()
    if (this.running !== undefined) return
    let run: Promise<void>
    try {
      run = this.ctx.agents.withoutInitiator(async () => {
        while (this.requested && !this.stopping) {
          this.requested = false
          await this.drive()
        }
      })
    } catch (error: unknown) {
      // Ancestor unloading closes initiator admission before runtime cleanup runs.
      this.requested = false
      this.ctx.logger.warn(`schedule: dispatch stopped: ${String(error)}`)
      return
    }
    this.running = run
    void run.catch((error: unknown) => {
      this.ctx.logger.warn(`schedule: dispatch stopped: ${String(error)}`)
    }).finally(() => {
      this.running = undefined
      /* v8 ignore next -- a request can arrive in the microtask gap between the drive loop and this finalizer. */
      if (this.requested && !this.stopping) this.requestDrive()
    })
  }

  /** Stop the timer and drain an accepted delivery before storage closes. */
  async dispose(): Promise<void> {
    this.stopping = true
    this.stop.abort()
    this.clearTimer()
    // requestDrive reports execution failures; teardown only waits for quiescence.
    await this.running?.catch(() => undefined)
    await Promise.allSettled([...this.manual])
  }

  /**
   * Queue one manual execution without consuming or moving its scheduled occurrence.
   * @param id - Canonical task identity resolved again inside the shared transaction.
   * @param signal - Cancellation checked after entering the transaction and before delivery.
   * @returns Admission and task state after durable Session inbox acknowledgement, or undefined when deleted first.
   */
  async runNow(id: ScheduleId, signal?: AbortSignal): Promise<
    { readonly task: ScheduleTask; readonly admitted: boolean } | undefined
  > {
    const run = this.ctx.agents.withoutInitiator(async () => {
      const task = await this.exclusive(() => {
        signal?.throwIfAborted()
        if (this.stopping) throw new Error('Schedule runtime is stopping')
        return this.current(id)
      })
      if (task === undefined) return
      if (this.executing.has(id)
        || this.nextAdmissionAt(task) > Date.now()
        || await this.recoverOutstandingExecution(task)) {
        return this.declined(id)
      }
      const resolved = await this.resolveTarget(task)
      if (this.stopping) throw new Error('Schedule runtime is stopping')
      if (resolved === undefined) return this.declined(id)
      const staged = await this.exclusive(() => {
        signal?.throwIfAborted()
        if (this.stopping) throw new Error('Schedule runtime is stopping')
        const current = this.current(id)
        if (current === undefined || !isDeepStrictEqual(current.target, resolved.task.target)
          || this.executing.has(id) || this.nextAdmissionAt(current) > Date.now()) return
        const occurrenceAt = new Date(Date.now()).toISOString()
        return {
          current, occurrenceAt,
          sent: this.enqueue(resolved.target.agent, renderReminderFraming({ ...current.record, scheduledAt: occurrenceAt }), [id]),
        }
      })
      if (staged === undefined) return this.declined(id)
      const { sent, occurrenceAt } = staged
      const committed = new Set<ScheduleId>()
      try {
        const deliveredAt = await this.flushed(sent)
        const delivered = await this.transact(async () => {
          const current = this.current(id)
          if (current === undefined) return
          const next = this.keepTarget(this.delivered(current, {
            scheduledAt: occurrenceAt, deliveredAt, messageId: sent.messageId, targetSessionId: resolved.target.sessionId,
          }), current, staged.current)
          await this.commit(next)
          committed.add(id)
          return next
        })
        return delivered === undefined ? undefined : { task: delivered, admitted: true }
      } finally {
        this.settle(sent.held, committed, sent.execution)
      }
    })
    this.manual.add(run)
    try {
      return await run
    } finally {
      this.manual.delete(run)
    }
  }

  /**
   * Whether a queued or running execution holds this task's slot.
   * @param id - Task identity.
   * @returns Whether the task's latest delivery has not yet reached whole-agent idle in its target Session.
   */
  isExecutionActive(id: ScheduleId): boolean {
    return this.executing.has(id)
  }

  /**
   * End of this task's current minimum delivery interval.
   * @param task - Current durable task state.
   * @returns Epoch milliseconds while the interval remains in the future.
   */
  deliveryFloorEnd(task: ScheduleTask): number | undefined {
    const end = this.nextAdmissionAt(task)
    return end > Date.now() ? end : undefined
  }

  private clearTimer(): void {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
  }

  private async drive(): Promise<void> {
    this.clearTimer()
    const failed = new Set<ScheduleId>()
    const handled = new Set<ScheduleId>()
    const due = await this.exclusive(() => {
      const scanNow = Date.now()
      return this.tasks().filter(task => task.status === 'active'
        && !this.executing.has(task.record.id)
        && Date.parse(task.record.scheduledAt) <= scanNow)
    })
    for (const task of due) {
      if (this.stopping) return
      if (handled.has(task.record.id)) continue
      const session = batchSessionOf(task)
      const group = session === undefined ? [task] : due.filter(candidate => batchSessionOf(candidate) === session)
      for (const member of group) handled.add(member.record.id)
      for (const id of await this.deliverDue(group, session !== undefined)) failed.add(id)
    }
    if (this.stopping) return
    const retryAt = failed.size === 0 ? undefined : Date.now() + Math.min(RETRY_BASE_MS * 2 ** this.failureStreak, RETRY_MAX_MS)
    this.failureStreak = failed.size === 0 ? 0 : this.failureStreak + 1
    const next = this.tasks().filter(task => task.status === 'active'
      && !failed.has(task.record.id)
      && !this.executing.has(task.record.id))
      .reduce<number | undefined>((at, task) => {
        const target = Math.max(Date.parse(task.record.scheduledAt), this.nextAdmissionAt(task))
        return at === undefined ? target : Math.min(at, target)
      }, retryAt)
    if (next !== undefined) {
      this.timer = setTimeout(() => { this.timer = undefined; this.requestDrive() },
        Math.max(0, Math.min(next - Date.now(), MAX_TIMER_DELAY_MS)))
      this.timer.unref()
    }
  }

  /**
   * Deliver one due group in one message and advance each committed member.
   * @param group - One task, or the due recurring tasks of one target Session.
   * @param batch - Whether the message uses the batch framing.
   * @returns Members that remain due after a failure; `drive` retries them with bounded backoff.
   */
  private async deliverDue(group: readonly ScheduleTask[], batch: boolean): Promise<readonly ScheduleId[]> {
    let admitted = group
    const committed = new Set<ScheduleId>()
    const superseded = new Set<ScheduleId>()
    try {
      const candidates: ScheduleTask[] = []
      for (const member of group) {
        const live = this.current(member.record.id)
        if (live === undefined || live.status !== 'active' || this.executing.has(member.record.id)) continue
        if (this.nextAdmissionAt(live) > Date.now() || await this.recoverOutstandingExecution(live)) continue
        candidates.push(live)
      }
      const checkedAt = Date.now()
      admitted = candidates.filter(member => Date.parse(member.record.scheduledAt) <= checkedAt)
      const first = admitted[0]
      if (first === undefined) return []
      const resolved = await this.resolveTarget(first)
      if (this.stopping || resolved === undefined) return []
      admitted = [resolved.task, ...admitted.slice(1)]
      const staged = await this.exclusive(() => {
        const now = Date.now()
        const live = admitted.filter(member => !this.executing.has(member.record.id)
          && isDeepStrictEqual(this.current(member.record.id), member) && Date.parse(member.record.scheduledAt) <= now)
        const deliveries: StagedMember[] = live.map(task => ({
          task, occurrence: isRecurringScheduleRecord(task.record)
            ? resolveRecurringOccurrence(task.record, now) : { occurrenceAt: task.record.scheduledAt },
        }))
        const single = deliveries[0]
        if (single === undefined) return { live, sent: undefined, deliveries }
        const text = batch
          ? renderRecurringReminderBatchFraming(deliveries.map(({ task, occurrence }) => ({
            record: task.record, occurrenceAt: occurrence.occurrenceAt,
          })))
          : renderReminderFraming({ ...single.task.record, scheduledAt: single.occurrence.occurrenceAt })
        return { live, sent: this.enqueue(resolved.target.agent, text, live.map(task => task.record.id)), deliveries }
      })
      const { sent, deliveries } = staged
      admitted = staged.live
      if (sent === undefined) return []
      try {
        const deliveredAt = await this.flushed(sent)
        await this.transact(async () => {
          for (const member of deliveries) {
            if (await this.commitMember(member, resolved.target.sessionId, sent, deliveredAt)) committed.add(member.task.record.id)
            else superseded.add(member.task.record.id)
          }
        })
      } finally {
        this.settle(sent.held, committed, sent.execution)
      }
      return []
    } catch (error: unknown) {
      const pending = admitted.filter(member => !committed.has(member.record.id) && !superseded.has(member.record.id))
      const failedAt = Date.now()
      const ids = pending.map(member => member.record.id)
      this.ctx.logger.warn(`schedule: reminders ${JSON.stringify(ids)} were not acknowledged: ${String(error)}`)
      return pending.filter(member => Date.parse(member.record.scheduledAt) <= failedAt).map(member => member.record.id)
    }
  }

  /** Earliest wall-clock instant at which this task may admit another delivery. */
  private nextAdmissionAt(task: ScheduleTask): number {
    const receipt = task.lastDelivery
    if (receipt === undefined) return Number.NEGATIVE_INFINITY
    const interval = task.target.kind === 'new' ? this.limits.newSessionIntervalMs : MIN_DELIVERY_INTERVAL_MS
    const occurrence = Date.parse(receipt.scheduledAt)
    // An occurrence whose successor already keeps the interval anchors the floor, so acknowledgment latency neither
    // accumulates across occurrences nor carries a deferral forward.
    const anchor = Date.parse(task.record.scheduledAt) - occurrence >= interval ? occurrence : Date.parse(receipt.deliveredAt)
    return anchor + interval
  }

  /** Whether the Workspace registry lists this Session as archived; without a registry, no Session is archived. */
  private archived(sessionId: SessionIdType): boolean {
    return this.ctx.get('workspaceRegistry')?.archivedSessionIds.includes(sessionId) ?? false
  }

  /**
   * Reconstruct a still-queued last delivery after a Host restart without storing model completion state.
   * @param task - Task whose last delivered message may still wait in its target inbox.
   * @returns Whether the task holds its slot for that delivery.
   */
  private async recoverOutstandingExecution(task: ScheduleTask): Promise<boolean> {
    if (this.executing.has(task.record.id)) return true
    const receipt = task.lastDelivery
    // The archived-Session gate blocks the turn that a requeued reminder would wake.
    if (receipt === undefined || this.archived(receipt.targetSessionId)) return false
    let agent: Agent
    try {
      agent = await this.activate(receipt.targetSessionId)
    } catch (error: unknown) {
      if (error instanceof DeliveryStepAbandonedError) throw error
      this.ctx.logger.warn(`schedule: could not restore the last delivery's Session for task "${task.record.id}": ${String(error)}`)
      return false
    }
    if (this.executing.has(task.record.id)) return true
    const message = [...agent.inbox.nextTurn, ...agent.inbox.nextStep].find(candidate => candidate.id === receipt.messageId)
    if (message === undefined) return false
    const held = this.tasks().filter(candidate => candidate.lastDelivery?.messageId === receipt.messageId
      && candidate.lastDelivery.targetSessionId === receipt.targetSessionId).map(candidate => candidate.record.id)
    for (const id of held) this.executing.add(id)
    try {
      if (agent.status === 'idle') {
        // A restored inbox does not wake an idle Agent by itself. Requeue the
        // same identity at the next-turn tail so followup opens its driver
        // without creating a second logical delivery or Session.
        agent.inbox.remove(message.id)
        agent.followup(message)
        const execution = held.length > 0 ? agent.whenIdle() : undefined
        const flushed = await this.bounded(this.ctx.sessions.flush(agent.session), true)
        if (!flushed) throw new Error('Session persistence did not acknowledge the recovered reminder')
        if (execution !== undefined) this.watchExecution(held, execution)
      } else if (held.length > 0) {
        this.watchExecution(held, agent.whenIdle())
      }
      return held.includes(task.record.id)
    } catch (error: unknown) {
      for (const id of held) this.executing.delete(id)
      throw error
    }
  }

  private enqueue(agent: Agent, text: string, held: readonly ScheduleId[]): EnqueuedReminder {
    const message = createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'schedule' } })
    for (const id of held) this.executing.add(id)
    try {
      agent.followup(message)
      const execution = held.length > 0 ? agent.whenIdle() : undefined
      return { agent, held, messageId: message.id, execution }
    } catch (error: unknown) {
      for (const id of held) this.executing.delete(id)
      throw error
    }
  }

  private async flushed(sent: EnqueuedReminder): Promise<string> {
    try {
      const acknowledged = await this.bounded(this.ctx.sessions.flush(sent.agent.session), true)
      if (!acknowledged) throw new Error('Session persistence did not acknowledge the reminder')
    } catch (error: unknown) {
      this.withdraw(sent)
      throw error
    }
    return new Date(Date.now()).toISOString()
  }

  private withdraw(sent: EnqueuedReminder): void {
    try {
      sent.agent.inbox.remove(sent.messageId)
    } catch (error: unknown) {
      this.ctx.logger.warn(`schedule: could not withdraw the unacknowledged reminder ${sent.messageId}: ${String(error)}`)
    }
  }

  private exclusive<T>(work: () => T): Promise<T> {
    return this.transact(() => Promise.resolve().then(work))
  }

  private current(id: ScheduleId): ScheduleTask | undefined {
    return this.tasks().find(task => task.record.id === id)
  }

  private declined(id: ScheduleId): { readonly task: ScheduleTask; readonly admitted: false } | undefined {
    const task = this.current(id)
    return task === undefined ? undefined : { task, admitted: false }
  }

  private bounded<T>(operation: Promise<T>, enqueued = false): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    let grace: ReturnType<typeof setTimeout> | undefined
    let onAbort: (() => void) | undefined
    const expired = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { reject(new DeliveryStepAbandonedError(`schedule: delivery step exceeded ${DELIVERY_STEP_TIMEOUT_MS} ms`)) }, DELIVERY_STEP_TIMEOUT_MS)
      timer.unref()
      const stopping = (): void => { reject(new DeliveryStepAbandonedError('Schedule runtime is stopping')) }
      onAbort = enqueued ? () => { grace = setTimeout(stopping, STOP_FLUSH_GRACE_MS) } : stopping
      if (this.stop.signal.aborted) onAbort()
      else this.stop.signal.addEventListener('abort', onAbort, { once: true })
    })
    return Promise.race([operation, expired]).finally(() => {
      clearTimeout(timer)
      clearTimeout(grace)
      if (onAbort !== undefined) this.stop.signal.removeEventListener('abort', onAbort)
    })
  }

  private async commitMember(
    { task, occurrence }: StagedMember, sessionId: SessionIdType, sent: EnqueuedReminder, deliveredAt: string,
  ): Promise<boolean> {
    const current = this.current(task.record.id)
    if (current === undefined) return false
    const receipt = { scheduledAt: occurrence.occurrenceAt, deliveredAt, messageId: sent.messageId, targetSessionId: sessionId }
    const sameRule = current.status === 'active'
      && isDeepStrictEqual({ ...current.record, title: '', prompt: '' }, { ...task.record, title: '', prompt: '' })
    const next = sameRule ? this.advanced(current, occurrence, receipt) : this.delivered(current, receipt)
    await this.commit(this.keepTarget(next, current, task))
    return true
  }

  private keepTarget(next: ScheduleTask, current: ScheduleTask, expected: ScheduleTask): ScheduleTask {
    return isDeepStrictEqual(current.target, expected.target)
      ? next
      : { ...next, target: current.target, pendingDelivery: current.pendingDelivery }
  }

  /** Release each uncommitted held slot now and each committed one at the target Agent's whole-agent idle boundary. */
  private settle(held: readonly ScheduleId[], committed: ReadonlySet<ScheduleId>, execution: Promise<void> | undefined): void {
    for (const id of held) {
      if (!committed.has(id)) this.executing.delete(id)
    }
    const watched = held.filter(id => committed.has(id))
    if (watched.length > 0 && execution !== undefined) this.watchExecution(watched, execution)
  }

  /** Release admitted executions at the target Agent's whole-agent idle boundary, then recompute the timer. */
  private watchExecution(ids: readonly ScheduleId[], execution: Promise<void>): void {
    const finish = (): void => {
      for (const id of ids) this.executing.delete(id)
      if (this.stopping) return
      this.changed()
      this.requestDrive()
    }
    void execution.then(finish, finish)
  }

  /** Apply one receipt to the target, involved Sessions, and history while keeping the scheduled occurrence. */
  private delivered(task: ScheduleTask, receipt: ScheduleDeliveryReceipt): ScheduleTask {
    return {
      ...task,
      target: task.target.kind === 'new_once' ? { kind: 'session', sessionId: receipt.targetSessionId } : task.target,
      // Each delivery of a `new` target creates a Session; recording them all would grow the task without bound.
      involvedSessionIds: task.target.kind === 'new'
        ? task.involvedSessionIds
        : [...new Set([...task.involvedSessionIds, receipt.targetSessionId])],
      updatedAt: new Date(Math.max(
        Date.parse(receipt.deliveredAt),
        task.updatedAt === undefined ? Date.parse(receipt.deliveredAt) : Date.parse(task.updatedAt) + 1,
      )).toISOString(),
      pendingDelivery: undefined,
      ...appendDelivery(task, receipt, this.limits.retention),
    }
  }

  /** Apply one timed receipt and advance the rule that owns dispatch to its next target. */
  private advanced(task: ScheduleTask, occurrence: RecurringOccurrence, receipt: ScheduleDeliveryReceipt): ScheduleTask {
    const scheduledAt = occurrence.nextScheduledAt ?? occurrence.occurrenceAt
    return {
      ...this.delivered(task, receipt),
      record: { ...task.record, scheduledAt },
      status: occurrence.nextScheduledAt === undefined ? 'ended' : 'active',
    }
  }

  /**
   * Resolve the delivery target and its live Agent.
   * A `new` target reserves its Session identity in the task before creation, so a failed delivery retries the same
   * Session instead of creating another. A stored reserved identity is resolved first and created only when no Session
   * has it, because the Session controller creates a Session with a different id when the named Session has already
   * started a turn. A created Session joins the Workspace registered at `create.cwd` and takes the task title; a `new`
   * target's title adds its launch time in the task's time zone. Neither step blocks delivery.
   */
  private async resolveTarget(task: ScheduleTask): Promise<ResolvedTarget | undefined> {
    const { target } = task
    const reserved = target.kind === 'new' ? task.pendingDelivery?.targetSessionId : target.sessionId
    // An archived Session cannot run the reminder, including a retry in an already-created reserved Session.
    if (reserved !== undefined && this.archived(reserved)) {
      throw new RemoteError('schedule/target-archived', `Session ${reserved} is archived`, { sessionId: reserved })
    }
    if (target.kind === 'session') {
      return { target: { sessionId: target.sessionId, agent: await this.activate(target.sessionId) }, task }
    }
    let sessionId: SessionIdType
    let agent: Agent | undefined
    let basis = task
    if (target.kind === 'new_once') {
      sessionId = target.sessionId
      agent = await this.reservedAgent(sessionId)
    } else if (task.pendingDelivery === undefined) {
      sessionId = brandString<SessionIdType>(`session-${randomUUID()}`)
      const reservedTask = await this.reserve(task, sessionId)
      if (reservedTask === undefined) return
      basis = reservedTask
    } else {
      sessionId = task.pendingDelivery.targetSessionId
      agent = await this.reservedAgent(sessionId)
    }
    agent ??= await this.createAgent(sessionId, target.create)
    await this.joinWorkspace(sessionId, target.create.cwd)
    this.nameSession(agent, basis)
    return { target: { sessionId, agent }, task: basis }
  }

  private reserve(task: ScheduleTask, sessionId: SessionIdType): Promise<ScheduleTask | undefined> {
    return this.transact(async () => {
      if (!isDeepStrictEqual(this.current(task.record.id), task)) return
      const next = { ...task, pendingDelivery: { targetSessionId: sessionId } }
      await this.commit(next)
      return this.current(task.record.id) ?? next
    })
  }

  /** Resolve the live Agent of a reserved Session; `undefined` means that no Session has its id yet. */
  private async reservedAgent(sessionId: SessionIdType): Promise<Agent | undefined> {
    try {
      return await this.activate(sessionId)
    } catch (error: unknown) {
      if (error instanceof SessionPersistenceNotFoundError
        || (error instanceof RemoteError && error.code === 'session/not-found')) return undefined
      throw error
    }
  }

  /** Resolve through the embedding's activation owner, with the injected Web controller as fallback. */
  private activate(sessionId: SessionIdType): Promise<Agent> {
    return this.bounded(this.ctx.waterfall('schedule/resolve-agent', sessionId, () => this.resolveAgent(sessionId)))
  }

  /** Create a reserved Session with the target's working directory and Agent preset, then resolve its live Agent. */
  private async createAgent(sessionId: SessionIdType, create: ScheduleSessionCreateSpec): Promise<Agent> {
    const controller = this.ctx.get('sessionController')
    if (controller === undefined) throw new Error('schedule: no Session creation provider')
    await this.bounded(controller.create({
      sessionId,
      ...(create.cwd === undefined ? {} : { cwd: create.cwd }),
      ...(create.agentPreset === undefined ? {} : { agentPreset: create.agentPreset }),
    }))
    return this.activate(sessionId)
  }

  /** Attach a created Session to the Workspace registered at its directory; a failure is logged and does not stop delivery. */
  private async joinWorkspace(sessionId: SessionIdType, cwd: string | undefined): Promise<void> {
    const registry = this.ctx.get('workspaceRegistry')
    if (registry === undefined || cwd === undefined) return
    try {
      await this.bounded((async () => (await registry.resolveByPath(cwd))?.attachSession(sessionId))())
    } catch (error: unknown) {
      this.ctx.logger.warn(`schedule: Session ${sessionId} did not join the Workspace at ${cwd}: ${String(error)}`)
    }
  }

  /** Name a created Session that has no title yet; a failure is logged and does not stop delivery. */
  private nameSession(agent: Agent, task: ScheduleTask): void {
    const titles = this.ctx.get('sessionTitle')
    if (titles === undefined || titles.get(agent.session) !== undefined) return
    const { title } = task.record
    try {
      titles.rename(agent.session, task.target.kind === 'new' ? `${title} · ${formatScheduleLocalTime(task.record, new Date().toISOString()).slice(0, 16).replace('T', ' ')}` : title)
    } catch (error: unknown) {
      this.ctx.logger.warn(`schedule: Session ${agent.id} was not named: ${String(error)}`)
    }
  }
}

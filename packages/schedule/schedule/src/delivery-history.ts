/** Saved delivery retention and identity-based pagination without Session reads. */
import { promptIdOf, type ScheduleTask } from './storage.ts'
import type {
  DeliveryRetentionBounds, ScheduleDeliveryHistoryRequest, ScheduleDeliveryHistoryResult, ScheduleDeliveryReceipt,
} from './types.ts'

/** Milliseconds in one day, the unit the retention window is stated in. */
const DAY_MS = 86_400_000

export const MAX_HISTORY_PROMPT_BYTES = 1_048_576

/**
 * Prepare one real inbox acknowledgment for the same task write as its status and target.
 * Prunes to the configured window and record cap here, on the only write path, so a task record does not grow
 * with every acknowledgment.
 * @param task - Task supplying the immutable sent prompt and retained history.
 * @param receipt - Acknowledgment obtained after successful Session flush.
 * @param bounds - Configured retention window and record cap for the appended history.
 * @returns Receipt and retained history; the caller publishes them only after task persistence.
 */
export function appendDelivery(
  task: ScheduleTask,
  receipt: ScheduleDeliveryReceipt,
  bounds: DeliveryRetentionBounds,
): Required<Pick<ScheduleTask, 'lastDelivery' | 'deliveryHistory'>> {
  const history = task.deliveryHistory
  const delivered: ScheduleDeliveryReceipt = {
    scheduledAt: receipt.scheduledAt, deliveredAt: receipt.deliveredAt, messageId: receipt.messageId,
    targetSessionId: receipt.targetSessionId,
  }
  const promptId = promptIdOf(task.record.prompt)
  const prompts: Record<string, string> = { ...history.prompts, [promptId]: task.record.prompt }
  const appended = [...history.records, { ...delivered, promptId }]
  const floor = Date.parse(receipt.deliveredAt) - bounds.days * DAY_MS
  const counted = appended
    .filter(record => Date.parse(record.deliveredAt) >= floor)
    .slice(-bounds.records)
  const sizeOf = (id: string): number => Buffer.byteLength(prompts[id] ?? '')
  const references = new Map<string, number>()
  for (const record of counted) {
    if (record.promptId !== undefined) references.set(record.promptId, (references.get(record.promptId) ?? 0) + 1)
  }
  let bytes = [...references.keys()].reduce((total, id) => total + sizeOf(id), 0)
  let first = 0
  while (first < counted.length - 1 && bytes > MAX_HISTORY_PROMPT_BYTES) {
    const dropped = counted[first]?.promptId
    first += 1
    if (dropped === undefined) continue
    const remaining = (references.get(dropped) ?? 0) - 1
    references.set(dropped, remaining)
    if (remaining === 0) bytes -= sizeOf(dropped)
  }
  const retained = counted.slice(first)
  const retainedPrompts: Record<string, string> = {}
  for (const record of retained) {
    const text = record.promptId === undefined ? undefined : prompts[record.promptId]
    if (record.promptId !== undefined && text !== undefined) retainedPrompts[record.promptId] = text
  }
  return {
    lastDelivery: delivered,
    deliveryHistory: {
      records: retained,
      prompts: retainedPrompts,
      earlierRecordsUnavailable: history.earlierRecordsUnavailable || retained.length !== appended.length,
      earlierRecordsPruned: history.earlierRecordsPruned || retained.length !== appended.length,
    },
  }
}

/**
 * Read one newest-first page in append order, independent of wall-clock ordering.
 * @param task - Task already selected by the caller.
 * @param request - Validated explicit page size and optional exclusive message cursor.
 * @param retention - Current configured limits shared with the delivery writer.
 * @returns Copied delivery records or a cursor-not-found result.
 */
export function deliveryHistoryPage(
  task: ScheduleTask, request: ScheduleDeliveryHistoryRequest, retention: DeliveryRetentionBounds,
): ScheduleDeliveryHistoryResult {
  const history = task.deliveryHistory
  const end = request.before === undefined
    ? history.records.length
    : history.records.findIndex(record => record.messageId === request.before)
  if (end === -1) return { id: request.id, code: 'delivery_cursor_not_found' }
  const start = Math.max(0, end - request.limit)
  const records = history.records.slice(start, end).reverse().map(({ promptId, ...receipt }) => {
    const prompt = promptId === undefined ? undefined : history.prompts?.[promptId]
    return { ...receipt, ...(prompt === undefined ? {} : { prompt }) }
  })
  const oldest = records.at(-1)
  return {
    id: request.id, records, earlierRecordsUnavailable: history.earlierRecordsUnavailable,
    earlierRecordsPruned: history.earlierRecordsPruned, retention: { ...retention },
    ...(oldest !== undefined && start > 0 ? { nextBefore: oldest.messageId } : {}),
  }
}

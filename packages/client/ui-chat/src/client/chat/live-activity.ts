/** The running Turn's in-flight operation, read from the Chat legacy slice. */
import { activity, type ProcessActivity } from '../contract/process-groups.ts'
import { isRunningTool } from '../contract/chat-nodes.ts'
import type {
  CommandNode, LegacyConversationSlice, ModelRetryNode, PartialAssistant, RunningToolCall, ToolCallBlock,
} from '../contract/snapshot.ts'
import { liveToolDetail } from '@deepseek-ai/dsh-util-values'

/** Silence after which a running Turn shows the inactivity hint. */
export const INACTIVITY_HINT_MS = 120_000

const CHARACTERS_PER_TOKEN = 4

/** The single in-flight operation a running Turn is waiting on, shown in the status line. */
export type LiveActivity =
  | { readonly kind: 'tool'; readonly process: ProcessActivity; readonly detail: string; readonly since: number }
  | { readonly kind: 'job'; readonly jobId: string; readonly waiting: boolean; readonly since: number }
  | { readonly kind: 'retry'; readonly attempt: number; readonly since: number }
  | { readonly kind: 'compacting'; readonly since: number }
  | { readonly kind: 'generating'; readonly key: string; readonly writing: boolean; readonly tokens: number }
  | { readonly kind: 'idle' }

type Args = Readonly<Record<string, unknown>>

function parseArgs(argsRaw: string): Args {
  try {
    const parsed: unknown = JSON.parse(argsRaw)
    return typeof parsed === 'object' && parsed !== null ? parsed as Args : {}
  } catch {
    return {}
  }
}

function runningCalls(blocks: readonly ToolCallBlock[]): RunningToolCall[] {
  return blocks.flatMap((block) => {
    const own = isRunningTool(block) ? [block] : []
    return [...own, ...runningCalls(block.subCalls)]
  })
}

function latestCall(calls: readonly RunningToolCall[]): RunningToolCall | undefined {
  return calls.reduce<RunningToolCall | undefined>(
    (latest, call) => latest === undefined || call.time >= latest.time ? call : latest,
    undefined,
  )
}

function toolActivity(call: RunningToolCall): LiveActivity {
  const args: Args = call.phase === 'start' ? parseArgs(call.argsRaw) : {}
  const jobId = args.job_id
  if (call.name === 'job_output' && typeof jobId === 'string' && jobId !== '') {
    return { kind: 'job', jobId, waiting: args.wait === true, since: call.time }
  }
  const process = activity(call.name)
  const detail = call.phase === 'start' ? liveToolDetail(call.name, call.argsRaw)
    : process === 'tools' ? call.name : ''
  return { kind: 'tool', process, detail, since: call.time }
}

function generatingActivity(partial: PartialAssistant): LiveActivity {
  let characters = 0
  let writing = false
  for (const block of partial.blocks) {
    if (block.kind === 'text') {
      characters += block.text.length
      if (block.text !== '') writing = true
    } else if (block.kind === 'reasoning') {
      characters += block.text.length
    }
  }
  return {
    kind: 'generating',
    key: `${partial.turn}:${partial.step}`,
    writing,
    tokens: Math.ceil(characters / CHARACTERS_PER_TOKEN),
  }
}

/**
 * Derive the running Turn's in-flight operation from the legacy Chat slice.
 * @param legacy - Chat legacy slice carrying running tools, partial output, nodes.
 * @returns the latest running tool, else streamed output, retry, compaction, or idle.
 */
export function liveActivity(legacy: LegacyConversationSlice): LiveActivity {
  const call = latestCall(runningCalls(legacy.runningCalls))
  if (call !== undefined) return toolActivity(call)
  if (legacy.partial !== null) return generatingActivity(legacy.partial)
  const retry = legacy.nodes.findLast((node): node is ModelRetryNode =>
    node.kind === 'model-retry' && node.retryState === 'scheduled')
  if (retry !== undefined) return { kind: 'retry', attempt: retry.retry, since: retry.time }
  const compaction = legacy.nodes.findLast((node): node is CommandNode =>
    node.kind === 'command' && node.name === 'compact' && node.outcome === null)
  if (compaction !== undefined) return { kind: 'compacting', since: compaction.time }
  return { kind: 'idle' }
}

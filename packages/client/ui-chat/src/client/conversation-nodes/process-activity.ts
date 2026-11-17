/** Tool-category and live-detail interpretation owned by Chat grouping. */
import { reasoningText } from '../reasoning-text.ts'
import type { ToolArgs } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { diffTotals, type DiffHunk } from '@deepseek-ai/dsh-client-ui-primitives'
import { PartialArguments } from '@deepseek-ai/dsh-util-values'
import { activity, type ProcessActivity, type ProcessActivitySummary } from '../contract/process-groups.ts'
import type { ChatNode } from '../contract/chat-nodes.ts'
import { isRunningTool } from '../contract/chat-nodes.ts'
import type { ToolCallBlock } from '../contract/snapshot.ts'

const LIVE_TOOL_DETAIL_MAX_CHARS = 160
const LIVE_TOOL_DETAIL_PREFIX_CHARS = 512
const LIVE_TOOL_DETAIL_SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const LIVE_TOOL_DETAIL_KEYS = [
  'title', 'description', 'objective', 'task', 'task_name', 'name', 'question', 'questions', 'prompt', 'message',
  'command', 'cmd', 'queries', 'query', 'pattern', 'url', 'uri', 'file_path', 'path', 'target', 'action', 'status',
] as const

interface NormalizedDetail {
  readonly text: string
  readonly truncated: boolean
}

function normalizeLiveToolText(text: string): NormalizedDetail {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= LIVE_TOOL_DETAIL_MAX_CHARS) return { text: normalized, truncated: false }
  const chars: string[] = []
  for (const { segment } of LIVE_TOOL_DETAIL_SEGMENTER.segment(normalized)) {
    if (chars.length === LIVE_TOOL_DETAIL_MAX_CHARS) {
      return {
        text: `${chars.slice(0, LIVE_TOOL_DETAIL_MAX_CHARS - 1).join('').trimEnd()}…`,
        truncated: true,
      }
    }
    chars.push(segment)
  }
  return { text: normalized, truncated: false }
}

function normalizeLiveToolDetail(value: unknown): string {
  const text = typeof value === 'string'
    ? value
    : Array.isArray(value) && value.every(item => typeof item === 'string')
      ? value.join(', ')
      : ''
  return normalizeLiveToolText(text).text
}

function argumentTextDetail(args: ToolArgs, key: string): string | undefined {
  let limit = LIVE_TOOL_DETAIL_PREFIX_CHARS
  while (true) {
    let prefix = args.textPrefix(key, limit)
    if (prefix === undefined) return undefined
    const last = prefix.charCodeAt(prefix.length - 1)
    if (last >= 0xd800 && last <= 0xdbff) {
      // The extra prefix read also observes a low surrogate arriving in a later delta.
      const extended = args.textPrefix(key, limit + 1) as string
      const next = extended.charCodeAt(prefix.length)
      if (next >= 0xdc00 && next <= 0xdfff) {
        prefix = extended
        limit++
      } else if (extended.length === prefix.length && !args.isSealed && !args.complete(key)) {
        prefix = prefix.slice(0, -1)
      }
    }
    const detail = normalizeLiveToolText(prefix)
    if (detail.truncated || !args.stringExceeds(key, limit)) return detail.text
    limit *= 2
  }
}

function questionDetail(value: unknown): string {
  if (!Array.isArray(value)) return ''
  for (const item of value) {
    if (item === null || typeof item !== 'object') continue
    const detail = normalizeLiveToolDetail(Reflect.get(item, 'question'))
    if (detail !== '') return detail
  }
  return ''
}

function liveReasoningDetail(nodes: readonly ChatNode[]): string {
  for (let nodeIndex = nodes.length - 1; nodeIndex >= 0; nodeIndex--) {
    const node = nodes[nodeIndex]
    if (node?.kind !== 'assistant-step' || node.data.status !== 'running') continue
    for (let blockIndex = node.data.blocks.length - 1; blockIndex >= 0; blockIndex--) {
      const block = node.data.blocks[blockIndex]
      if (block?.kind !== 'reasoning') continue
      const paragraphs = reasoningText(block.text).split(/\r?\n[\t ]*\r?\n/)
      for (let paragraphIndex = paragraphs.length - 1; paragraphIndex >= 0; paragraphIndex--) {
        const detail = normalizeLiveToolDetail(paragraphs[paragraphIndex]?.replaceAll('**', ''))
        if (detail !== '') return detail
      }
    }
  }
  return ''
}

/**
 * One-line task detail from the argument view, read the same way while the
 * arguments stream and after dispatch: the first detail key present with text
 * so far or a closed value. Without one, the tool name stands in once no further
 * field can arrive; a field still to come is not named early.
 */
function liveToolDetail(name: string, args: ToolArgs): string {
  for (const key of LIVE_TOOL_DETAIL_KEYS) {
    if (!args.has(key)) continue
    const detail = key === 'questions'
      ? questionDetail(args.value(key))
      : argumentTextDetail(args, key) ?? normalizeLiveToolDetail(args.value(key))
    if (detail !== '') return detail
  }
  return args.closed() ? normalizeLiveToolDetail(name) : ''
}

const FILE_KINDS = new Set<ProcessActivity>(['read', 'readImage', 'write', 'edit'])

function fileName(args: ToolArgs): string | undefined {
  const path = args.text('file_path')
  if (path === undefined) return undefined
  const name = path.split(/[\\/]/).pop() ?? ''
  return name === '' ? undefined : name
}

function isDiffHunk(value: unknown): value is DiffHunk {
  if (typeof value !== 'object' || value === null) return false
  const path: unknown = Reflect.get(value, 'path')
  const oldText: unknown = Reflect.get(value, 'oldText')
  const newText: unknown = Reflect.get(value, 'newText')
  return typeof path === 'string' && (oldText === null || typeof oldText === 'string') && typeof newText === 'string'
}

function appliedHunks(meta: unknown): DiffHunk[] | undefined {
  const diffs: unknown = typeof meta === 'object' && meta !== null ? Reflect.get(meta, 'diffs') : undefined
  return Array.isArray(diffs) && diffs.length > 0 && diffs.every(isDiffHunk) ? diffs : undefined
}

function intendedHunks(kind: 'write' | 'edit', args: ToolArgs): DiffHunk[] {
  const path = args.text('file_path')
  if (path === undefined) return []
  if (kind === 'write') {
    const content = args.text('content')
    return content === undefined ? [] : [{ path, oldText: null, newText: content }]
  }
  const oldText = args.text('old_string')
  const newText = args.text('new_string')
  return oldText === undefined || newText === undefined ? [] : [{ path, oldText, newText }]
}

function changedHunks(kind: ProcessActivity, tool: ToolCallBlock, args: ToolArgs): DiffHunk[] {
  if (kind !== 'write' && kind !== 'edit') return []
  if (isRunningTool(tool)) return intendedHunks(kind, args)
  if (tool.isError) return []
  return appliedHunks(tool.meta) ?? intendedHunks(kind, args)
}

/**
 * Rank categories by distinct call count, breaking ties by first appearance, and total the file work.
 * @param nodes - process members, including recursive tools.
 * @returns ranked categories with file targets, line totals, and the latest running tool category and bounded task detail.
 */
export function processActivity(nodes: readonly ChatNode[]): ProcessActivitySummary {
  const tallies = new Map<ProcessActivity, { count: number; targets: string[] }>()
  const seen = new Set<string>()
  let running: ProcessActivity | undefined
  let runningDetail = ''
  let runningTime = -Infinity
  let preparing: boolean | undefined
  let added = 0
  let removed = 0
  const visit = (tool: ToolCallBlock): void => {
    if (seen.has(tool.callId)) return
    seen.add(tool.callId)
    const call = isRunningTool(tool) ? tool : tool.call
    if (call !== null) {
      const kind = activity(call.name)
      if (isRunningTool(tool) && tool.time >= runningTime) {
        running = kind
        preparing = tool.phase === 'preparing'
        const detail = liveToolDetail(tool.name, tool.args)
        runningDetail = detail === '' && tool.phase === 'preparing' && kind === 'tools' ? tool.name : detail
        runningTime = tool.time
      }
      const args = isRunningTool(tool) && tool.phase === 'preparing' ? PartialArguments.EMPTY : tool.args
      const tally = tallies.get(kind) ?? { count: 0, targets: [] }
      tallies.set(kind, tally)
      tally.count++
      const target = FILE_KINDS.has(kind) ? fileName(args) : undefined
      if (target !== undefined && !tally.targets.includes(target)) tally.targets.push(target)
      const totals = diffTotals(changedHunks(kind, tool, args))
      added += totals.added
      removed += totals.removed
    }
    for (const child of tool.subCalls) visit(child)
  }
  for (const node of nodes) {
    if (node.kind === 'tool-call') visit(node.data.root)
  }
  if (running === undefined) runningDetail = liveReasoningDetail(nodes)
  return {
    counts: [...tallies]
      .map(([kind, { count, targets }]) => ({ kind, count, targets }))
      .sort((a, b) => b.count - a.count),
    running,
    runningDetail,
    ...preparing ? { preparing: true } : {},
    added,
    removed,
  }
}

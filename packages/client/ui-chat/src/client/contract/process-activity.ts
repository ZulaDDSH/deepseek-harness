/** Tool-category and live-detail interpretation owned by Chat grouping. */
import { diffTotals, type DiffHunk } from '@deepseek-ai/dsh-client-ui-primitives'
import { liveToolDetail, normalizeLiveToolDetail } from '@deepseek-ai/dsh-util-values'
import type { ProcessActivity, ProcessActivitySummary } from './process-groups.ts'
import type { ChatNode } from './chat-nodes.ts'
import { isRunningTool } from './chat-nodes.ts'
import type { ToolCallBlock } from './snapshot.ts'

export { liveToolDetail }

/**
 * Map a tool name to the process category that groups and labels it.
 * @param name - tool name as the model called it.
 * @returns the process category; unknown names fall back to `tools`.
 */
export function activity(name: string): ProcessActivity {
  if (name === 'read') return 'read'
  if (name === 'read_image') return 'readImage'
  if (name === 'grep' || name === 'glob' || name.endsWith('_inspect')) return 'search'
  if (name === 'write') return 'write'
  if (name === 'edit' || name === 'apply_patch') return 'edit'
  if (['bash', 'pwsh', 'exec_command', 'write_stdin'].includes(name) || name.startsWith('terminal_')) return 'commands'
  if (name === 'run_code') return 'code'
  if (name === 'web_search') return 'webSearch'
  if (name === 'web_fetch') return 'webFetch'
  if (name === 'subagent' || name.startsWith('subagent_')) return 'subagents'
  if (['todo_write', 'create_goal', 'update_goal', 'get_goal'].includes(name)) return 'plan'
  if (name === 'ask_user_question' || name === 'request_user_input') return 'questions'
  return 'tools'
}

function liveReasoningDetail(nodes: readonly ChatNode[]): string {
  for (let nodeIndex = nodes.length - 1; nodeIndex >= 0; nodeIndex--) {
    const node = nodes[nodeIndex]
    if (node?.kind !== 'assistant-step' || node.data.status !== 'running') continue
    for (let blockIndex = node.data.blocks.length - 1; blockIndex >= 0; blockIndex--) {
      const block = node.data.blocks[blockIndex]
      if (block?.kind !== 'reasoning') continue
      const paragraphs = block.text.split(/\r?\n[\t ]*\r?\n/)
      for (let paragraphIndex = paragraphs.length - 1; paragraphIndex >= 0; paragraphIndex--) {
        const detail = normalizeLiveToolDetail(paragraphs[paragraphIndex]?.replaceAll('**', ''))
        if (detail !== '') return detail
      }
    }
  }
  return ''
}

type ToolArgs = Record<string, unknown>

const FILE_KINDS = new Set<ProcessActivity>(['read', 'readImage', 'write', 'edit'])

function objectArgs(argsRaw: string): ToolArgs {
  try {
    const args: unknown = JSON.parse(argsRaw)
    return args !== null && typeof args === 'object' && !Array.isArray(args) ? args as ToolArgs : {}
  } catch (_error: unknown) {
    return {}
  }
}

function fileName(args: ToolArgs): string | undefined {
  const path: unknown = Reflect.get(args, 'file_path')
  if (typeof path !== 'string') return undefined
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
  const path: unknown = Reflect.get(args, 'file_path')
  if (typeof path !== 'string') return []
  if (kind === 'write') {
    const content: unknown = Reflect.get(args, 'content')
    return typeof content === 'string' ? [{ path, oldText: null, newText: content }] : []
  }
  const oldText: unknown = Reflect.get(args, 'old_string')
  const newText: unknown = Reflect.get(args, 'new_string')
  return typeof oldText === 'string' && typeof newText === 'string' ? [{ path, oldText, newText }] : []
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
 * @returns ranked categories with file targets, line totals, and the latest running tool category and bounded detail.
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
        runningDetail = tool.phase === 'preparing'
          ? kind === 'tools' ? tool.name : ''
          : liveToolDetail(tool.name, tool.argsRaw)
        runningTime = tool.time
      }
      const args = 'argsRaw' in call ? objectArgs(call.argsRaw) : {}
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

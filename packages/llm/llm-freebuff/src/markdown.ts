import type { ChatBlock, ChatMessage } from './chat.ts'
import { stripAnsi } from './launch.ts'

const OUTPUT_MAX_CHARS = 2_048

export interface RenderedBlock {
  readonly kind: 'text' | 'reasoning'
  readonly text: string
}

function fenced(output: string): string {
  const longest = Math.max(0, ...(output.match(/`+/g) ?? []).map(run => run.length))
  const fence = '`'.repeat(Math.max(3, longest + 1))
  return `${fence}\n${output}\n${fence}`
}

function boundedOutput(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  const text = stripAnsi(raw).replaceAll('\r\n', '\n').trim()
  return text.length > OUTPUT_MAX_CHARS ? `${text.slice(0, OUTPUT_MAX_CHARS)}\n... (output truncated)` : text
}

function paths(input: unknown): string[] {
  const list = (input as { paths?: unknown } | undefined)?.paths
  return Array.isArray(list) ? list.filter((path): path is string => typeof path === 'string') : []
}

function toolText(block: ChatBlock): string {
  if (block.toolName === 'read_files') {
    const read = paths(block.input)
    if (read.length > 0) return `Read ${read.map(path => `\`${path}\``).join(', ')}`
  }
  if (block.toolName === 'run_terminal_command') {
    const command = (block.input as { command?: unknown } | undefined)?.command
    if (typeof command === 'string') {
      const output = boundedOutput(block.output)
      return `Ran \`${command.replaceAll('`', "'")}\`${output.length === 0 ? '' : `\n\n${fenced(output)}`}`
    }
  }
  return `Used \`${block.toolName ?? 'a tool'}\``
}

export function renderBlocks(messages: readonly ChatMessage[]): RenderedBlock[] {
  const items = messages
    .filter(message => message.variant === 'ai')
    .flatMap(message => (message.blocks ?? [])
      .filter(block => block.type === 'text' || block.type === 'tool')
      .map(block => ({ block, rowComplete: message.isComplete === true })))
  const rendered: RenderedBlock[] = []
  items.forEach(({ block, rowComplete }, index) => {
    const settled = rowComplete || index < items.length - 1
    let next: RenderedBlock
    if (block.type === 'tool') {
      if (!settled) return
      next = { kind: 'text', text: toolText(block) }
    } else {
      if (typeof block.content !== 'string' || block.content.length === 0) return
      next = { kind: block.textType === 'reasoning' ? 'reasoning' : 'text', text: block.content }
    }
    const last = rendered.at(-1)
    if (last?.kind === next.kind) rendered[rendered.length - 1] = { kind: next.kind, text: `${last.text}\n\n${next.text}` }
    else rendered.push(next)
  })
  return rendered
}

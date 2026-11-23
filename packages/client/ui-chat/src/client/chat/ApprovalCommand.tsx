/** Chat-owned approval detail resolving a correlated Tool call's arguments. */
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-approval/client'
import type { ChatNode } from '../contract/chat-nodes.ts'
import css from './ApprovalCommand.module.css'

interface ApprovalToolCall {
  readonly callId: string
  readonly name?: string
  readonly argsRaw: string
}

/**
 * Extract the command line from a correlated Tool call: a shell `command`, or the text `terminal_send` types into a terminal.
 * @param call - Tool call name and arguments, when a correlated call exists.
 * @returns command text, or undefined for absent, empty, malformed, or unrelated arguments.
 */
export function commandOf(call: ApprovalToolCall | undefined): string | undefined {
  if (call === undefined) return undefined
  try {
    const args = JSON.parse(call.argsRaw) as Record<string, unknown>
    const command = call.name === 'terminal_send' ? args.text : args.command
    return typeof command === 'string' && command.length > 0 ? command : undefined
  } catch {
    return undefined
  }
}

const MAX_LINES = 40
const MAX_JSON_CHARS = 4096

function clipLines(text: string): string {
  const lines = text.split('\n')
  return lines.length <= MAX_LINES ? text : [...lines.slice(0, MAX_LINES), '…'].join('\n')
}

/**
 * Describe a correlated Tool call for approval: its command, write, edit, run_code source, or pretty JSON.
 * @param call - Tool call arguments, when a correlated call exists.
 * @returns detail text, or undefined for absent, malformed, or empty arguments.
 */
export function approvalDetail(call: ApprovalToolCall | undefined): string | undefined {
  if (call === undefined) return undefined
  let parsed: unknown
  try { parsed = JSON.parse(call.argsRaw) } catch { return undefined }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
  const args = parsed as Record<string, unknown>
  if (call.name === 'terminal_send' && typeof args.text === 'string') return args.text || undefined
  if (typeof args.command === 'string') return args.command
  if (typeof args.file_path === 'string' && typeof args.content === 'string') return `${args.file_path}\n${clipLines(args.content)}`
  if (typeof args.file_path === 'string' && typeof args.old_string === 'string' && typeof args.new_string === 'string') {
    const mark = (prefix: string, text: string): string => clipLines(text).split('\n').map(line => `${prefix}${line}`).join('\n')
    return `${args.file_path}\n${mark('- ', args.old_string)}\n${mark('+ ', args.new_string)}`
  }
  if (typeof args.code === 'string') return clipLines(args.code)
  if (Object.keys(args).length === 0) return undefined
  const json = JSON.stringify(args, null, 2)
  return json.length <= MAX_JSON_CHARS ? json : `${json.slice(0, MAX_JSON_CHARS)}…`
}

/**
 * Render the detail of the Chat Tool node correlated with an approval.
 * @param props - Approval identity and Session-standard Chat selector hook.
 * @returns detail text when the correlated call carries arguments worth showing.
 */
export function ApprovalCommand({ callId, useChat }: PropsRuntime<'conversation.approval.detail'>) {
  const detail = useChat((snapshot) => {
    for (const node of snapshot.nodes.values()) {
      const root = node.kind === 'tool-call' ? (node as ChatNode<'tool-call'>).data.root : undefined
      if (root !== undefined && root.callId === callId && !('kind' in root) && root.phase === 'start') return approvalDetail(root)
    }
    return undefined
  })
  return detail === undefined ? null : <pre className={css.detail}>{detail}</pre>
}

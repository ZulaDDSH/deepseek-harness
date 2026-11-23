/** Chat-owned approval detail resolving a correlated Tool call's arguments. */
import { Fragment, useEffect, useMemo } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-approval/client'
import type { ChatNode } from '../contract/chat-nodes.ts'
import type { ChatSnapshot } from '../contract/snapshot.ts'
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

const MAX_VALUE_CHARS = 200

/**
 * Describe a correlated Tool call for approval: its command, write, edit, run_code source, or pretty JSON.
 * @param call - Tool call arguments, when a correlated call exists.
 * @returns detail text, or undefined for absent, malformed, or empty arguments.
 */
export function approvalDetail(call: ApprovalToolCall | undefined): string | undefined {
  return describeApproval(call)?.preview
}

export interface ApprovalDetailView {
  readonly preview: string | undefined
  readonly rest: readonly (readonly [string, string])[]
  readonly full: string | undefined
}

export function describeApproval(call: ApprovalToolCall | undefined): ApprovalDetailView | undefined {
  if (call === undefined) return undefined
  let parsed: unknown
  try { parsed = JSON.parse(call.argsRaw) } catch { return undefined }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
  const args = parsed as Record<string, unknown>
  let clipped = false
  const clipLines = (text: string): string => {
    const lines = text.split('\n')
    if (lines.length <= MAX_LINES) return text
    clipped = true
    return [...lines.slice(0, MAX_LINES), '…'].join('\n')
  }
  const consumed = new Set<string>()
  let preview: string | undefined
  if (call.name === 'terminal_send' && typeof args.text === 'string' && args.text !== '') {
    consumed.add('text')
    preview = args.text
  } else if (typeof args.command === 'string') {
    consumed.add('command')
    preview = args.command
  } else if (typeof args.file_path === 'string' && typeof args.content === 'string') {
    consumed.add('file_path').add('content')
    preview = `${args.file_path}\n${clipLines(args.content)}`
  } else if (typeof args.file_path === 'string' && typeof args.old_string === 'string' && typeof args.new_string === 'string') {
    consumed.add('file_path').add('old_string').add('new_string')
    const mark = (prefix: string, text: string): string => clipLines(text).split('\n').map(line => `${prefix}${line}`).join('\n')
    preview = `${args.file_path}\n${mark('- ', args.old_string)}\n${mark('+ ', args.new_string)}`
  } else if (typeof args.code === 'string') {
    consumed.add('code')
    preview = clipLines(args.code)
  } else if (Object.keys(args).length > 0) {
    for (const key of Object.keys(args)) consumed.add(key)
    const json = JSON.stringify(args, null, 2)
    clipped = json.length > MAX_JSON_CHARS
    preview = clipped ? `${json.slice(0, MAX_JSON_CHARS)}…` : json
  }
  const rest = Object.entries(args).filter(([key]) => !consumed.has(key)).map(([key, value]): readonly [string, string] => {
    const text = JSON.stringify(value)
    if (text.length <= MAX_VALUE_CHARS) return [key, text]
    clipped = true
    return [key, `${text.slice(0, MAX_VALUE_CHARS)}…`]
  })
  return { preview, rest, full: clipped ? JSON.stringify(args, null, 2) : undefined }
}

/**
 * Render the detail of the Chat Tool node correlated with an approval.
 * @param props - Approval identity and Session-standard Chat selector hook.
 * @returns detail text when the correlated call carries arguments worth showing.
 */
export function ApprovalCommand({ callId, useChat, t, onAvailability }: PropsRuntime<'conversation.approval.detail'> & PropsLocale<'chat'>) {
  const correlated = (snapshot: ChatSnapshot): ApprovalToolCall | undefined => {
    for (const node of snapshot.nodes.values()) {
      const root = node.kind === 'tool-call' ? (node as ChatNode<'tool-call'>).data.root : undefined
      if (root !== undefined && root.callId === callId && !('kind' in root) && root.phase === 'start') return root
    }
    return undefined
  }
  const argsRaw = useChat(snapshot => correlated(snapshot)?.argsRaw)
  const name = useChat(snapshot => correlated(snapshot)?.name)
  const view = useMemo(
    () => argsRaw === undefined ? undefined : describeApproval({ callId, ...(name === undefined ? {} : { name }), argsRaw }),
    [callId, name, argsRaw],
  )
  const available = view !== undefined
  useEffect(() => { onAvailability?.(available) }, [available, onAvailability])
  if (view === undefined) return null
  return (
    <>
      {view.preview !== undefined && <pre className={css.detail}>{view.preview}</pre>}
      {view.rest.length > 0 && (
        <dl className={css.arguments}>
          {view.rest.map(([key, value]) => (
            <Fragment key={key}><dt>{key}</dt><dd>{value}</dd></Fragment>
          ))}
        </dl>
      )}
      {view.full !== undefined && (
        <details className={css.full}>
          <summary>{t('approval.fullArguments')}</summary>
          <pre className={css.detail}>{view.full}</pre>
        </details>
      )}
    </>
  )
}

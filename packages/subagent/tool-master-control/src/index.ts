import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { brandString } from '@deepseek-ai/dsh-brand'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent, SessionId, TurnEndReason } from '@deepseek-ai/dsh-session'
import { finalAssistantOutput } from '@deepseek-ai/dsh-subagent'

export const name = 'tool-master-control'
export const inject = ['tools', 'agents']

/** Cap for `mc_send` wait so a hung peer cannot block the caller forever. */
export const MC_SEND_WAIT_MS = 120_000

/** Max chars for `mc_list_sessions` last_reply excerpts. */
export const LAST_REPLY_MAX = 280

/** Relayed messages one session may send the same peer inside one exchange window. */
export const MC_RELAY_LIMIT = 12

/** Window over which repeated relays to one peer count as a message loop. */
export const MC_RELAY_WINDOW_MS = 60_000

/** Master control configuration specifying managed session enrollment. */
export interface Config {
  /** When true, every loaded session other than the caller is enrolled. */
  managedAll?: boolean
  /** Session ids enrolled when `managedAll` is false. Empty by default. */
  managed?: string[]
}

/** Schema and defaults for master control configuration. */
export const Config: z<Config> = z.object({
  managedAll: z.boolean().default(false),
  managed: z.array(z.string()).default([]),
})

function callerOf(caller: Agent | undefined, tool: string): Agent {
  if (!caller) throw new Error(`${tool} requires a calling agent (exec.agent was undefined)`)
  return caller
}

function target(ctx: Context, config: Config, caller: Agent, id: string, tool: string): Agent {
  if (id === caller.id) throw new Error(`${tool}: cannot target the calling session itself`)
  if (!config.managedAll && !(config.managed ?? []).includes(id)) {
    throw new Error(`${tool}: session ${id} is not enrolled under master control`)
  }
  const agent = ctx.agents.get(brandString<SessionId>(id))
  if (!agent) throw new Error(`${tool}: session ${id} is not loaded; open it in the UI first`)
  return agent
}

/** Snapshot one live session log for a same-process read. */
function snapshot(agent: Agent): readonly SessionEvent[] {
  return agent.session.snapshotEvents()
}

/**
 * Select the reply text of one event suffix.
 * @param events - events to fold.
 * @returns the trimmed final assistant text, or undefined when there is none.
 */
function replyText(events: readonly SessionEvent[]): string | undefined {
  const blocks = finalAssistantOutput(events)
  if (blocks === undefined) return undefined
  const text = blocks
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map(b => b.text)
    .join('\n')
    .trim()
  return text === '' ? undefined : text
}

function excerpt(text: string, max = LAST_REPLY_MAX): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

async function waitIdle(agent: Agent, tool: string): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      agent.whenIdle(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(
            `${tool}: timed out waiting for session ${agent.id} after ${MC_SEND_WAIT_MS / 1000}s`,
          ))
        }, MC_SEND_WAIT_MS)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** The `mc_send` arguments this plugin reads back from its own durable tool calls. */
interface SendArguments {
  /** Target session id recorded for the call. */
  readonly sessionId?: string
  /** Whether the call asked to wait for the target. */
  readonly wait: boolean
}

/**
 * Read one durable `mc_send` tool call's arguments.
 * @param raw - raw JSON arguments exactly as recorded in the session log.
 * @returns the recognized fields, or undefined when the value is not a JSON object.
 */
function sendArguments(raw: string): SendArguments | undefined {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    // Tool-call arguments are model output; a value that is not JSON carried no mc_send field.
    return undefined
  }
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  const sessionId = record['session_id']
  return {
    ...typeof sessionId === 'string' ? { sessionId } : {},
    wait: record['wait'] === true,
  }
}

/**
 * The peer one session is blocked on inside its own unsettled `mc_send` wait.
 * @param agent - the session whose log is inspected.
 * @returns the awaited session id, or undefined when no wait is in flight.
 */
function waitingOn(agent: Agent): string | undefined {
  const pending = new Map<string, string>()
  for (const event of snapshot(agent)) {
    if (event.type === 'tool/call' && event.data.name === 'mc_send') {
      const args = sendArguments(event.data.arguments)
      if (args?.wait === true && args.sessionId !== undefined) pending.set(event.data.callId, args.sessionId)
    } else if (event.type === 'tool/result') {
      pending.delete(event.data.message.toolCallId)
    }
  }
  return [...pending.values()].at(-1)
}

/**
 * Find the wait-for cycle that waiting on `target` would close, so two sessions
 * cannot both block on each other until the timeout.
 * @param ctx - the agent registry that resolves each hop.
 * @param caller - the session about to wait.
 * @param target - the session it would wait on.
 * @returns the session ids from the target back to the caller, or undefined when waiting is safe.
 */
function waitCycle(ctx: Context, caller: Agent, target: Agent): readonly string[] | undefined {
  const trail: string[] = []
  const visited = new Set<string>()
  let current: Agent | undefined = target
  while (current !== undefined) {
    const id = current.id as string
    trail.push(id)
    if (current.id === caller.id) return trail
    if (visited.has(id)) return undefined
    visited.add(id)
    const next = waitingOn(current)
    if (next === undefined) return undefined
    current = ctx.agents.get(brandString<SessionId>(next))
  }
  return undefined
}

/**
 * Count this session's settled relays to one peer inside the loop window.
 * @param agent - the session that would send.
 * @param targetId - the peer the new message targets.
 * @param now - current epoch milliseconds.
 * @returns how many completed `mc_send` calls that peer received inside {@link MC_RELAY_WINDOW_MS}.
 */
function recentRelays(agent: Agent, targetId: string, now: number): number {
  const open = new Map<string, { readonly targetId: string; readonly time: number }>()
  let settled = 0
  for (const event of snapshot(agent)) {
    if (event.type === 'tool/call' && event.data.name === 'mc_send') {
      const args = sendArguments(event.data.arguments)
      if (args?.sessionId !== undefined) open.set(event.data.callId, { targetId: args.sessionId, time: event.time })
    } else if (event.type === 'tool/result') {
      const relay = open.get(event.data.message.toolCallId)
      if (relay === undefined) continue
      open.delete(event.data.message.toolCallId)
      if (relay.targetId === targetId && relay.time >= now - MC_RELAY_WINDOW_MS
        && event.data.error === undefined) settled++
    }
  }
  return settled
}

/**
 * Describe why a turn ended, for a caller that waited on it.
 * @param reason - the recorded turn ending; completion reports a reply instead.
 * @returns a model-facing clause naming the ending.
 */
function endingText(reason: Exclude<TurnEndReason, { kind: 'completed' }>): string {
  if (reason.kind === 'error') return `an error (${reason.error.message})`
  if (reason.kind === 'aborted') return `a cancellation (${reason.reason.kind})`
  return reason.kind
}

/** What waiting on one relayed message produced. */
interface RelayOutcome {
  /** Text of the assistant reply from the turn that ran the message. */
  readonly reply?: string
  /** Why no reply is available, when the turn failed, was cancelled, or produced no text. */
  readonly note?: string
}

/**
 * Read the outcome of the turn that consumed one relayed message. The reply is
 * scoped to that turn, so an earlier turn's answer is never reported as this
 * message's reply.
 * @param agent - the session that received the message.
 * @param caller - the session that sent it.
 * @param beforeSeq - last event seq observed before delivery.
 * @returns the turn's reply, or a note explaining why none is available.
 */
function relayOutcome(agent: Agent, caller: Agent, beforeSeq: number): RelayOutcome {
  const events = snapshot(agent)
  const relayIndex = events.findIndex(event => event.seq > beforeSeq
    && event.type === 'user/message'
    && event.data.source.kind === 'agent-message'
    && event.data.source.senderSessionId === caller.id)
  if (relayIndex === -1) {
    return { note: 'the target went idle without running the message; it may have been cancelled or is still queued' }
  }
  let startIndex = -1
  let turn = -1
  for (let index = relayIndex; index >= 0; index--) {
    const event = events.at(index)
    if (event?.type === 'turn/start') { startIndex = index; turn = event.data.turn; break }
  }
  if (startIndex === -1) return { note: 'the target recorded no turn for the message' }
  let reason: TurnEndReason | undefined
  let endIndex = -1
  for (let index = relayIndex; index < events.length; index++) {
    const event = events.at(index)
    if (event?.type === 'turn/end' && event.data.turn === turn) { endIndex = index; reason = event.data.reason; break }
  }
  if (endIndex === -1 || reason === undefined) return { note: 'the message\'s turn has not settled' }
  if (reason.kind !== 'completed') {
    return { note: `the target's turn ended with ${endingText(reason)} before replying` }
  }
  const reply = replyText(events.slice(relayIndex, endIndex + 1))
  return reply === undefined
    ? { note: 'the target\'s turn completed without a text reply' }
    : { reply }
}

export function apply(ctx: Context, config: Config): void {
  ctx.tools.register(defineTool({
    name: 'mc_list_sessions',
    description:
      'List enrolled sessions that are currently loaded, with live status (running or idle), '
      + 'working directory, and a short excerpt of each session\'s last assistant reply when available. '
      + 'Use this to answer how sessions are doing.',
    parameters: {},
    output: {
      schema: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string', required: true },
            status: { type: 'string', required: true, enum: ['running', 'idle'] },
            cwd: { type: 'string' },
            last_reply: { type: 'string' },
          },
        },
      },
      render: (_args, rows) => [{
        type: 'text',
        text: rows.length === 0
          ? '(no managed sessions)'
          : rows.map((r) => {
            const head = `${r.id} [${r.status}]${r.cwd ? ` ${r.cwd}` : ''}`
            return r.last_reply === undefined ? head : `${head}\n  last: ${r.last_reply}`
          }).join('\n'),
      }],
    },
    execute(_args, exec) {
      const caller = callerOf(exec.agent, 'mc_list_sessions')
      return Promise.resolve(ctx.agents.list()
        .filter(a => a.id !== caller.id && (config.managedAll || (config.managed ?? []).includes(a.id)))
        .map((a) => {
          const last = replyText(snapshot(a))
          return {
            id: a.id,
            status: a.status,
            ...a.session.header.cwd === undefined ? {} : { cwd: a.session.header.cwd },
            ...last === undefined ? {} : { last_reply: excerpt(last) },
          }
        }))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'mc_send',
    description:
      'Send a message to an enrolled loaded session (peer or master). A running session receives it at '
      + 'its next step; an idle session starts a turn. Set wait=true to wait until that session goes idle '
      + 'and return the reply produced by the turn that ran the message (capped at 120s). If that turn '
      + 'fails or is cancelled, the result carries a note instead of an earlier reply. Repeated relays to '
      + 'one peer and wait cycles are refused so sessions cannot loop on each other.',
    parameters: {
      session_id: { type: 'string', required: true, description: 'The id of the enrolled session.' },
      message: { type: 'string', required: true, description: 'The message to deliver.' },
      wait: {
        type: 'boolean',
        description: 'When true, wait for the target to become idle and include its reply. Default false.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          delivered: { type: 'boolean', required: true },
          reply: { type: 'string' },
          note: { type: 'string' },
        },
      },
      render: (args, result) => {
        const head = `message delivered to session ${args.session_id}`
        if (result.reply !== undefined) return [{ type: 'text', text: `${head}; reply:\n${result.reply}` }]
        return [{ type: 'text', text: result.note === undefined ? head : `${head}; ${result.note}` }]
      },
    },
    async execute(args, exec) {
      const caller = callerOf(exec.agent, 'mc_send')
      const agent = target(ctx, config, caller, args.session_id, 'mc_send')
      if (recentRelays(caller, args.session_id, Date.now()) >= MC_RELAY_LIMIT) {
        throw new Error(
          `mc_send: refusing to relay another message to session ${args.session_id}: `
          + `${MC_RELAY_LIMIT} messages were sent within ${MC_RELAY_WINDOW_MS / 1000}s, which indicates a message loop. `
          + 'Stop relaying and report to your user.',
        )
      }
      if (args.wait === true) {
        const cycle = waitCycle(ctx, caller, agent)
        if (cycle !== undefined) {
          throw new Error(
            `mc_send: refusing to wait on session ${args.session_id}: `
            + `${cycle.join(' -> ')} is a wait cycle that would block both sessions until the timeout. `
            + 'Send the message with wait=false instead.',
          )
        }
      }
      const beforeSeq = snapshot(agent).at(-1)?.seq ?? -1
      agent.steer(createUserMessage({
        content: [{ type: 'text', text: `Agent ${caller.id} sent a message: ${args.message}` }],
        source: { kind: 'agent-message', form: 'relay', senderSessionId: caller.id },
      }))
      if (args.wait !== true) return { delivered: true }
      await waitIdle(agent, 'mc_send')
      return { delivered: true, ...relayOutcome(agent, caller, beforeSeq) }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'mc_interrupt',
    description: 'Stop the current turn of an enrolled session. The session stays available for later messages.',
    parameters: {
      session_id: { type: 'string', required: true, description: 'The id of the enrolled session.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { accepted: { type: 'boolean', required: true } } },
      render: args => [{ type: 'text', text: `interrupt requested for session ${args.session_id}` }],
    },
    execute(args, exec) {
      const caller = callerOf(exec.agent, 'mc_interrupt')
      target(ctx, config, caller, args.session_id, 'mc_interrupt').cancel({ kind: 'parent' })
      return Promise.resolve({ accepted: true })
    },
  }))
}

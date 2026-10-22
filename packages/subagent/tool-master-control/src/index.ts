import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { brandString } from '@deepseek-ai/dsh-brand'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { finalAssistantOutput } from '@deepseek-ai/dsh-subagent'

export const name = 'tool-master-control'
export const inject = ['tools', 'agents']

/** Cap for `mc_send` wait so a hung peer cannot block the caller forever. */
export const MC_SEND_WAIT_MS = 120_000

/** Max chars for `mc_list_sessions` last_reply excerpts. */
export const LAST_REPLY_MAX = 280

export interface Config {
  /** When true, every loaded session other than the caller is enrolled. */
  managedAll: boolean
  /** Session ids enrolled when `managedAll` is false. Empty by default. */
  managed: string[]
}

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
  if (!config.managedAll && !config.managed.includes(id)) {
    throw new Error(`${tool}: session ${id} is not enrolled under master control`)
  }
  const agent = ctx.agents.get(brandString<SessionId>(id))
  if (!agent) throw new Error(`${tool}: session ${id} is not loaded; open it in the UI first`)
  return agent
}

function replyText(agent: Agent): string | undefined {
  // oxlint-disable-next-line typescript/no-deprecated -- same history read as subagent lifecycle capture
  const blocks = finalAssistantOutput(agent.session.snapshotEvents())
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
        .filter(a => a.id !== caller.id && (config.managedAll || config.managed.includes(a.id)))
        .map((a) => {
          const last = replyText(a)
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
      + 'and return its last assistant reply (capped at 120s).',
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
        },
      },
      render: (args, result) => [{
        type: 'text',
        text: result.reply === undefined
          ? `message delivered to session ${args.session_id}`
          : `message delivered to session ${args.session_id}; reply:\n${result.reply}`,
      }],
    },
    async execute(args, exec) {
      const caller = callerOf(exec.agent, 'mc_send')
      const agent = target(ctx, config, caller, args.session_id, 'mc_send')
      agent.steer(createUserMessage({
        content: [{ type: 'text', text: `Agent ${caller.id} sent a message: ${args.message}` }],
        source: { kind: 'agent-message', form: 'relay', senderSessionId: caller.id },
      }))
      if (args.wait !== true) return { delivered: true }
      await waitIdle(agent, 'mc_send')
      const reply = replyText(agent)
      return { delivered: true, ...reply === undefined ? {} : { reply } }
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

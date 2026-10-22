import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { brandString } from '@deepseek-ai/dsh-brand'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { delegationDepthOf } from '@deepseek-ai/dsh-subagent'

export const name = 'tool-master-control'
export const inject = ['tools', 'agents']

export interface Config {
  managedAll: boolean
  managed: string[]
}

export const Config: z<Config> = z.object({
  managedAll: z.boolean().default(false),
  managed: z.array(z.string()).default([]),
})

function authorize(caller: Agent | undefined, tool: string): Agent {
  if (!caller) throw new Error(`${tool} requires a calling agent (exec.agent was undefined)`)
  if (delegationDepthOf(caller) !== 0) throw new Error(`${tool} is available to the master (root) agent only`)
  return caller
}

function target(ctx: Context, config: Config, caller: Agent, id: string, tool: string): Agent {
  if (id === caller.id) throw new Error(`${tool}: the master cannot target itself`)
  if (!config.managedAll && !config.managed.includes(id)) {
    throw new Error(`${tool}: session ${id} is not enrolled under master control`)
  }
  const agent = ctx.agents.get(brandString<SessionId>(id))
  if (!agent) throw new Error(`${tool}: session ${id} is not loaded; open it in the UI first`)
  return agent
}

export function apply(ctx: Context, config: Config): void {
  ctx.tools.register(defineTool({
    name: 'mc_list_sessions',
    description:
      'List the sessions under master control with their live status (running or idle) and working directory. '
      + 'Only sessions that are currently loaded can be listed.',
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
          },
        },
      },
      render: (_args, rows) => [{
        type: 'text',
        text: rows.length === 0 ? '(no managed sessions)' : rows.map(r => `${r.id} [${r.status}]${r.cwd ? ` ${r.cwd}` : ''}`).join('\n'),
      }],
    },
    execute(_args, exec) {
      const caller = authorize(exec.agent, 'mc_list_sessions')
      return Promise.resolve(ctx.agents.list()
        .filter(a => a.id !== caller.id && (config.managedAll || config.managed.includes(a.id)))
        .map(a => ({ id: a.id as string, status: a.status, ...a.session.header.cwd === undefined ? {} : { cwd: a.session.header.cwd } })))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'mc_send',
    description:
      'Send a message to a managed session. A running session receives it at its next step; an idle session starts a turn. '
      + 'Returns only confirmation of delivery, not the session\'s answer.',
    parameters: {
      session_id: { type: 'string', required: true, description: 'The id of the managed session.' },
      message: { type: 'string', required: true, description: 'The message to deliver.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { delivered: { type: 'boolean', required: true } } },
      render: args => [{ type: 'text', text: `message delivered to session ${args.session_id}` }],
    },
    execute(args, exec) {
      const caller = authorize(exec.agent, 'mc_send')
      const agent = target(ctx, config, caller, args.session_id, 'mc_send')
      agent.steer(createUserMessage({
        content: [{ type: 'text', text: `Master ${caller.id} sent a message: ${args.message}` }],
        source: { kind: 'agent-message', form: 'relay', senderSessionId: caller.id },
      }))
      return Promise.resolve({ delivered: true })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'mc_interrupt',
    description: 'Stop the current turn of a managed session. The session stays available for later messages.',
    parameters: {
      session_id: { type: 'string', required: true, description: 'The id of the managed session.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { accepted: { type: 'boolean', required: true } } },
      render: args => [{ type: 'text', text: `interrupt requested for session ${args.session_id}` }],
    },
    execute(args, exec) {
      const caller = authorize(exec.agent, 'mc_interrupt')
      target(ctx, config, caller, args.session_id, 'mc_interrupt').cancel({ kind: 'parent' })
      return Promise.resolve({ accepted: true })
    },
  }))
}

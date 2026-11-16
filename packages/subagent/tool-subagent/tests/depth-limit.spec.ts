/** Delegation tools at the depth cap: an agent whose child cannot run is not offered the tool. */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionId } from '@deepseek-ai/dsh-session'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import * as SubagentSpawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import * as tool from '../src/index.ts'

/** Mount the real spawn-backed delegation tool as a global composition. */
async function bootWith(config: tool.Config): Promise<Context> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx, { workingDirectory: true })
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(SubagentSpawn, { providerName: 'spawn' })
  await ctx.plugin(tool, config)
  return ctx
}

/** Create a top-level Agent, or a child of `parent` at the given delegation depth. */
async function createAgent(ctx: Context, id: string, child?: { parent: Agent; delegationDepth: number }): Promise<Agent> {
  const handle = child === undefined
    ? await ctx.agents.create({ sessionId: SessionId(id) })
    : await ctx.agents.create({
      sessionId: SessionId(id),
      meta: { parentSession: child.parent.id, origin: 'subagent', delegationDepth: child.delegationDepth },
    })
  return handle.agent
}

describe('delegation tool depth limit', () => {
  it('withholds the tool from a child that cannot delegate and keeps it on the top-level agent', async () => {
    const ctx = await bootWith({ provider: 'spawn' })
    const parent = await createAgent(ctx, 'top-level')
    const child = await createAgent(ctx, 'depth-one', { parent, delegationDepth: 1 })

    expect(ctx.tools.get('subagent', parent)).toBeDefined()
    expect(ctx.tools.get('subagent', child)).toBeUndefined()
    expect(ctx.tools.schemas(child).map(schema => schema.name)).not.toContain('subagent')
    await ctx.fiber.dispose()
  })

  it('keeps the tool on a child while a configured cap leaves room for its own child', async () => {
    const ctx = await bootWith({ provider: 'spawn', maxDepth: 2 })
    const parent = await createAgent(ctx, 'top-level')
    const child = await createAgent(ctx, 'depth-one', { parent, delegationDepth: 1 })
    const grandchild = await createAgent(ctx, 'depth-two', { parent: child, delegationDepth: 2 })

    expect(ctx.tools.get('subagent', child)).toBeDefined()
    expect(ctx.tools.get('subagent', grandchild)).toBeUndefined()
    await ctx.fiber.dispose()
  })
})

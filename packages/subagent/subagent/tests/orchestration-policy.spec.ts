/**
 * Root-only orchestration policy: the section renders for a top-level agent,
 * stays absent for a delegated child, and follows whichever route clause the
 * composed model router requires.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as orchestrationPolicy from '../src/orchestration-policy.ts'

const SECTION = 'orchestration:policy'

function agentAtDepth(depth: number): Agent {
  return {
    options: depth === 0 ? {} : { subagentDepth: depth },
    session: { header: {} },
  } as unknown as Agent
}

async function mount(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(orchestrationPolicy)
  return ctx
}

async function sectionFor(ctx: Context, agent?: Agent): Promise<string> {
  const assembly = await ctx.systemPrompt.assemble(agent === undefined ? {} : { agent })
  return assembly.sections.find(section => section.name === SECTION)?.text ?? ''
}

describe('root orchestration policy section', () => {
  it('reaches the root agent and states the delegation decision', async () => {
    const ctx = await mount()
    const text = await sectionFor(ctx, agentAtDepth(0))
    expect(text).toContain('You are the root agent for this session')
    expect(text).toContain('Write a workflow script when the same kind of work fans out')
    expect(text).toContain('never give two delegates overlapping write ownership')
    expect(text).toContain('Steer a running delegate with a message')
    expect(text).toContain('answer only after the delegates you depend on have settled')
  })

  it('stays absent for a delegated child, which already carries its own scope', async () => {
    const ctx = await mount()
    expect(await sectionFor(ctx, agentAtDepth(1))).toBe('')
    expect(await sectionFor(ctx, agentAtDepth(3))).toBe('')
  })

  it('stays absent for a subject-less assembly', async () => {
    const ctx = await mount()
    expect(await sectionFor(ctx)).toBe('')
  })

  it('lets the root name a child route when no router owns selection', async () => {
    const ctx = await mount()
    const text = await sectionFor(ctx, agentAtDepth(0))
    expect(text).toContain("A delegate inherits this agent's provider, model, and reasoning effort")
    expect(text).not.toContain("this deployment's router decides each agent's route")
  })

  it('forbids naming a child route once an enabled router owns selection', async () => {
    const ctx = await mount()
    ctx.provide('jevRouter', { enabled: true })
    const text = await sectionFor(ctx, agentAtDepth(0))
    expect(text).toContain("Do not name a delegate's provider, model, or reasoning effort")
    expect(text).not.toContain('A delegate inherits this agent\'s provider, model, and reasoning effort')
  })

  it('keeps the explicit route clause for a composed but disabled router', async () => {
    const ctx = await mount()
    ctx.provide('jevRouter', { enabled: false })
    const text = await sectionFor(ctx, agentAtDepth(0))
    expect(text).toContain("A delegate inherits this agent's provider, model, and reasoning effort")
    expect(text).not.toContain("Do not name a delegate's provider, model, or reasoning effort")
  })

  it('orders the policy after the team policy and before the knowledge policy', async () => {
    const ctx = await mount()
    const order = ctx.systemPrompt.getSectionOrder('ORCHESTRATION_POLICY')
    expect(order).toBeGreaterThan(ctx.systemPrompt.getSectionOrder('TEAM_POLICY'))
    expect(order).toBeLessThan(ctx.systemPrompt.getSectionOrder('KNOWLEDGE_POLICY'))
  })

  it('removes the section when the plugin is disposed (HMR safety)', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, {})
    const fiber = await ctx.plugin(orchestrationPolicy)
    expect(await sectionFor(ctx, agentAtDepth(0))).not.toBe('')
    await fiber.dispose()
    expect(await sectionFor(ctx, agentAtDepth(0))).toBe('')
  })
})

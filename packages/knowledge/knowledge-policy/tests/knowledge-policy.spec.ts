/**
 * Global shared-knowledge policy: one section for every agent scope, carrying
 * policy text only and never knowledge content.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as knowledgePolicy from '../src/index.ts'

async function mount(config: knowledgePolicy.Config = {}): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(knowledgePolicy, config)
  return ctx
}

function sectionText(assembly: { sections: Array<{ name: string; text: string }> }): string {
  return assembly.sections.find(section => section.name === 'knowledge:policy')?.text ?? ''
}

describe('knowledge policy section', () => {
  it('reaches an agent scope with no per-project setup', async () => {
    const ctx = await mount()
    const text = sectionText(await ctx.systemPrompt.assemble())
    expect(text).toContain('Shared knowledge is available through the configured knowledge tools')
  })

  it('ranks retrieved knowledge below current source, runtime, and test evidence', async () => {
    const ctx = await mount()
    const text = sectionText(await ctx.systemPrompt.assemble())
    expect(text).toContain('weaker authority than current repository source, runtime evidence, test results')
    expect(text).toContain('report the conflict and follow the current evidence')
  })

  it('separates worker retrieval from supervisor knowledge administration', async () => {
    const ctx = await mount()
    const text = sectionText(await ctx.systemPrompt.assemble())
    expect(text).toContain('Ordinary workers may retrieve knowledge and submit provisional candidate knowledge')
    expect(text).toContain('Only an authorized parent or supervisor may verify, promote, supersede')
  })

  it('forbids self-certification of a conclusion', async () => {
    const ctx = await mount()
    const text = sectionText(await ctx.systemPrompt.assemble())
    expect(text).toContain('Do not promote your own technical conclusion to verified or canonical status')
  })

  it('injects policy text only, never a knowledge dump', async () => {
    const ctx = await mount()
    const text = sectionText(await ctx.systemPrompt.assemble())
    // Bounded rule text: a knowledge dump would blow far past this budget.
    expect(text.length).toBeLessThan(1500)
    expect(text).toContain('Retrieve on demand')
  })

  it('renders stable text so the request prefix stays cacheable', async () => {
    const ctx = await mount()
    const first = sectionText(await ctx.systemPrompt.assemble())
    const second = sectionText(await ctx.systemPrompt.assemble())
    expect(first).toBe(second)
  })

  it('lets a deployment replace the policy text entirely', async () => {
    const ctx = await mount({ section: 'House rules for shared knowledge.' })
    expect(sectionText(await ctx.systemPrompt.assemble())).toBe('House rules for shared knowledge.')
  })

  it('orders the policy before tool sections and after the persona prefix', async () => {
    const ctx = await mount()
    expect(ctx.systemPrompt.getSectionOrder('KNOWLEDGE_POLICY'))
      .toBeGreaterThan(ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX'))
    expect(ctx.systemPrompt.getSectionOrder('KNOWLEDGE_POLICY'))
      .toBeLessThan(ctx.systemPrompt.getSectionOrder('TOOL_READ'))
  })

  it('removes the section when the plugin is disposed (HMR safety)', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, {})
    const fiber = await ctx.plugin(knowledgePolicy, {})
    expect(sectionText(await ctx.systemPrompt.assemble())).not.toBe('')
    await fiber.dispose()
    expect(sectionText(await ctx.systemPrompt.assemble())).toBe('')
  })
})

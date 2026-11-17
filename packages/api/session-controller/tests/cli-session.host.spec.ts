import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { agentPresetProjectionDefinition } from '@deepseek-ai/dsh-agent-preset-registry'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionId } from '@deepseek-ai/dsh-session'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { afterEach, describe, expect, it } from 'vitest'
import { ApiSessionAgentController } from '../src/agent.ts'
import { SessionCommandController } from '../src/commands.ts'
import { createSessionTestRemote, installSessionReadTestServices } from './test-remote.ts'

const roots: Context[] = []
const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose()))
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

async function baseHarness(): Promise<{ ctx: Context; cwd: string }> {
  const ctx = new Context()
  roots.push(ctx)
  await ctx.plugin(TypertRegistry)
  await mountAgentLoopTestDependencies(ctx)
  await mountAgentLoopTestHarness(ctx)
  installSessionReadTestServices(ctx)
  await ctx.sessionProjections.register(agentPresetProjectionDefinition)
  ctx.provide('agentDefaultModel', {
    currentSelection: () => ({ provider: 'fixture', model: 'fixture-model' }),
    saveSelection: () => Promise.resolve(),
  } as never)
  const cwd = mkdtempSync(join(tmpdir(), 'cli-session-'))
  tempDirs.push(cwd)
  return { ctx, cwd }
}

async function harness(): Promise<{ ctx: Context; commands: SessionCommandController; cwd: string }> {
  const { ctx, cwd } = await baseHarness()
  return { ctx, cwd, commands: new SessionCommandController(ctx, new ApiSessionAgentController(ctx), cwd) }
}

describe('CLI terminal Sessions', () => {
  it('records the profile marker before the Agent is announced', async () => {
    const { ctx, commands, cwd } = await harness()
    const announced: string[][] = []
    ctx.on('agent/created', ({ agent }) => {
      announced.push(agent.session.ownEvents().map(event => event.type))
    })
    const created = await commands.create({ cwd, cliProfile: 'gemini-cli' })
    expect(announced).toHaveLength(1)
    expect(announced[0]).toContain('session/cli-terminal')
    const agent = ctx.agents.get(SessionId(created.sessionId))
    expect(agent?.session.ownEvents().filter(event => event.type === 'session/cli-terminal').map(event => event.data))
      .toEqual([{ profile: 'gemini-cli' }])
  })

  it('refuses prompts without appending a user message', async () => {
    const { ctx, commands, cwd } = await harness()
    const created = await commands.create({ cwd, cliProfile: 'grok-cli' })
    await expect(commands.prompt({
      requestId: 'cli-prompt-1' as never,
      sessionId: SessionId(created.sessionId),
      mode: 'queue',
      content: [{ type: 'text', text: 'hello' }],
    }, { kind: 'user' })).rejects.toMatchObject({ code: 'session/cli-terminal' })
    expect(ctx.agents.get(SessionId(created.sessionId))?.session.ownEvents().some(event => event.type === 'user/message')).toBe(false)
  })

  it('refuses every turn-starting send at the Agent, so no schedule, goal, team or ACP path can wake it', async () => {
    const { ctx, commands, cwd } = await harness()
    const created = await commands.create({ cwd, cliProfile: 'gemini-cli' })
    const agent = ctx.agents.get(SessionId(created.sessionId))
    if (agent === undefined) throw new Error('agent missing')
    const message = () => createUserMessage({ content: [{ type: 'text', text: 'wake up' }], source: { kind: 'schedule' } })
    expect(() => { agent.followup(message()) }).toThrow('CLI terminal')
    expect(() => { agent.steer(message()) }).toThrow('CLI terminal')
    expect(agent.session.ownEvents().some(event => event.type === 'turn/start' || event.type === 'user/message')).toBe(false)
    const ordinary = await commands.create({ cwd })
    const plain = ctx.agents.get(SessionId(ordinary.sessionId))
    expect(() => { plain?.inject(message()) }).not.toThrow()
  })

  it('rejects an explicit identity or an unknown profile', async () => {
    const { commands, cwd } = await harness()
    await expect(commands.create({ sessionId: SessionId('explicit-cli-session'), cwd, cliProfile: 'gemini-cli' }))
      .rejects.toMatchObject({ code: 'gateway/bad-request' })
    await expect(commands.create({ cwd, cliProfile: 'unknown-cli' as never }))
      .rejects.toMatchObject({ code: 'gateway/bad-request' })
  })

  it('lists a CLI terminal Session as not blank with its profile', async () => {
    const { ctx, cwd } = await baseHarness()
    const remote = await createSessionTestRemote(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd })
    const created = await remote.create({ cwd, cliProfile: 'cursor-cli' })
    if (!created.ok) throw new Error('create failed')
    const listed = await remote.list({})
    if (!listed.ok) throw new Error('list failed')
    expect(listed.value.items.find(item => item.sessionId === created.value.sessionId))
      .toMatchObject({ blank: false, cliProfile: 'cursor-cli' })
  })

  it('announces a CLI terminal Session as not blank with its profile', async () => {
    const { ctx, cwd } = await baseHarness()
    const announced: { sessionId: string; blank: boolean; cliProfile?: string }[] = []
    ctx.on('api-session/added', (summary) => { announced.push(summary) })
    const remote = await createSessionTestRemote(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd })
    const created = await remote.create({ cwd, cliProfile: 'gemini-cli' })
    if (!created.ok) throw new Error('create failed')
    expect(announced.filter(item => item.sessionId === created.value.sessionId).at(-1))
      .toMatchObject({ blank: false, cliProfile: 'gemini-cli' })
  })

  it('creates a plain New Session that is never a CLI terminal Session', async () => {
    const { ctx, cwd } = await baseHarness()
    const remote = await createSessionTestRemote(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd })
    const cli = await remote.create({ cwd, cliProfile: 'gemini-cli' })
    const plain = await remote.create({ cwd })
    if (!cli.ok || !plain.ok) throw new Error('create failed')
    const listed = await remote.list({})
    if (!listed.ok) throw new Error('list failed')
    expect(listed.value.items.find(item => item.sessionId === plain.value.sessionId))
      .toMatchObject({ blank: true })
    expect(listed.value.items.find(item => item.sessionId === plain.value.sessionId)?.cliProfile).toBeUndefined()
    expect(listed.value.items.find(item => item.sessionId === cli.value.sessionId)).toMatchObject({ blank: false, cliProfile: 'gemini-cli' })
  })
})

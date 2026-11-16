import { mkdtemp, mkdir, writeFile, rm, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { agentPresetProjectionDefinition } from '@deepseek-ai/dsh-agent-preset-registry'
import * as JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionTitleService from '@deepseek-ai/dsh-session-title'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { createSessionTestController } from './test-remote.ts'
import { ApiSessionAgentController } from '../src/agent.ts'
import { SessionCommandController } from '../src/commands.ts'
import { ExternalChats } from '../src/external-chats.ts'
import { MasterControlSessions } from '../src/master-control.ts'

const contexts: Context[] = []
const roots: string[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function harness() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-master-control-'))
  roots.push(root)
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(JsonlSessionPersistence, { root: join(root, 'sessions'), compression: 'none' })
  await mountAgentLoopTestHarness(ctx)
  const adapter = new MockAdapter([textResponse('Continued in DSH')])
  ctx.llm.registerAdapter(['mock'], adapter)
  const archived: SessionId[] = []
  const sessionIds: SessionId[] = []
  const attachSession = vi.fn(async (id: SessionId) => { if (!sessionIds.includes(id)) sessionIds.push(id) })
  const workspace = { id: 'project', path: root, sessionIds, attachSession }
  ctx.provide('workspaceRegistry', { list: () => [workspace], archivedSessionIds: archived } as never)
  ctx.provide('agentPresets', {
    presetForSession: (session: Session) => agentPresetProjection.stateOf(session) ?? undefined,
    resolve: async (id: string) => ({ id }), mount: async () => undefined,
  } as never)
  const controller = await createSessionTestController(ctx, { defaultModelSelection: () => ({ provider: 'mock', model: 'mock' }), cwd: root })
  const agentPresetProjection = await ctx.sessionProjections.register(agentPresetProjectionDefinition)
  await ctx.plugin(SessionTitleService, { fallbackMaxWords: 5, fallbackMaxBytes: 80, maxTitleBytes: 200 })
  const flush = vi.fn()
  ctx.on('session/flush', () => { flush() })
  const agents = new ApiSessionAgentController(ctx)
  const commands = new SessionCommandController(ctx, agents, root)
  const claude = join(root, 'claude')
  const codex = join(root, 'codex')
  await mkdir(join(claude, 'project'), { recursive: true })
  await mkdir(codex)
  await writeFile(join(claude, 'project', 'chat.jsonl'), [
    { type: 'user', cwd: root, message: { role: 'user', content: 'Remember cobalt' } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'I remember cobalt' }] } },
  ].map(row => JSON.stringify(row)).join('\n') + '\n')
  const control = new MasterControlSessions(ctx, commands, new ExternalChats({ claude, codex }))
  return { ctx, root, commands, control, controller, adapter, archived, sessionIds, flush, attachSession }
}

describe('Master Control home and import', () => {
  it('imports a historical chat whose project folder was removed and preserves its source age', async () => {
    const b = await harness()
    const file = join(b.root, 'claude', 'project', 'chat.jsonl')
    await writeFile(file, JSON.stringify({ type: 'user', cwd: join(b.root, 'removed-project'), message: { role: 'user', content: 'Historical chat' } }) + '\n')
    const old = new Date('2026-10-01T00:00:00Z')
    await utimes(file, old, old)
    const catalog = await b.control.external.discover()
    const result = await b.control.importChats([catalog.items[0]!.key])
    expect(result.items[0]?.error).toBeUndefined()
    const listing = await b.controller.list({}, new AbortController().signal)
    expect(listing).toMatchObject({ items: [expect.objectContaining({
      sessionId: result.items[0]!.sessionId, updatedAt: old.getTime(), agentAvailable: false,
    })] })
  })
  it('serializes home clicks, ignores project masters, and recreates an archived home', async () => {
    const b = await harness()
    await b.commands.create({ sessionId: SessionId('project-master'), cwd: b.root, agentPreset: 'master' })
    await expect(b.commands.create({ sessionId: SessionId('master-control-home-claimed'), agentPreset: 'master' })).rejects.toThrow('identities are reserved')
    expect(b.ctx.sessions.get(SessionId('master-control-home-claimed'))).toBeUndefined()
    const [first, second] = await Promise.all([b.control.openHome(), b.control.openHome()])
    expect(first.sessionId).toBe(second.sessionId)
    expect(first.sessionId).toMatch(/^master-control-home-/)
    expect(b.ctx.sessionProjections.snapshot(b.ctx.sessions.get(first.sessionId)!, ['sessionListMetadata']).values.sessionListMetadata?.blank).toBe(false)
    expect(b.ctx.sessionProjections.snapshot(b.ctx.sessions.get(SessionId('project-master'))!, ['sessionListMetadata']).values.sessionListMetadata?.blank).toBe(true)
    expect(b.sessionIds).not.toContain(first.sessionId)
    expect(b.ctx.sessionTitle.get(b.ctx.sessions.get(first.sessionId)!)?.title).toBe('Master Control')
    expect((await b.control.openHome()).sessionId).toBe(first.sessionId)
    b.archived.push(first.sessionId)
    expect((await b.control.openHome()).sessionId).not.toBe(first.sessionId)
    expect(b.adapter.requests).toHaveLength(0)
  })

  it('imports history without a model call, isolates failures, preserves duplicates, and continues with the history', async () => {
    const b = await harness()
    const catalog = await b.control.external.discover()
    const key = catalog.items[0]!.key
    await expect(b.commands.create({ sessionId: SessionId(`imported-chat-${key}`) })).rejects.toThrow('identities are reserved')
    const result = await b.control.importChats(['invalid' as never, key])
    expect(result.items[0]?.error).toBeDefined()
    expect(result.items[1]?.error).toBeUndefined()
    const id = result.items[1]?.sessionId
    expect(id).toBeDefined()
    expect(b.ctx.agents.get(id!)).toBeUndefined()
    const resumed = await new ApiSessionAgentController(b.ctx).resolveAgent(id!)
    if ('error' in resumed) throw resumed.error
    const session = b.ctx.sessions.get(id!)!
    expect(session.header.agentPreset).toBe('standard')
    expect(session.deriveMessages().map(m => m.role)).toEqual(['user', 'assistant'])
    expect(b.sessionIds).toContain(id)
    expect(b.adapter.requests).toHaveLength(0)
    const handle = await b.ctx.sessionPersistence.open(id!, 'read')
    try {
      const stored = await handle.read()
      expect(stored.events.some(event => event.type === 'assistant/message')).toBe(true)
    } finally { await handle.close() }
    const events = session.snapshotEvents()
    expect((await b.control.importChats([key])).items[0]).toEqual({ key, sessionId: id, duplicate: true })
    expect(session.snapshotEvents()).toEqual(events)
    const agent = b.ctx.agents.get(id!)!
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'What did I ask you to remember?' }], source: { kind: 'user' } }))
    await agent.whenIdle()
    expect(JSON.stringify(b.adapter.requests.at(-1)?.messages)).toContain('Remember cobalt')
    expect(JSON.stringify(b.adapter.requests.at(-1)?.messages)).toContain('I remember cobalt')
    expect(JSON.stringify(b.adapter.requests.at(-1)?.messages)).toContain('What did I ask you to remember?')
    await b.ctx.sessions.flush(session)
    await b.ctx.fiber.dispose()
    const restarted = new Context()
    contexts.push(restarted)
    await restarted.plugin(JsonlSessionPersistence, { root: join(b.root, 'sessions'), compression: 'none' })
    const header = (await restarted.sessionPersistence.list()).find(row => row.header.id === id)!.header
    const reopened = await restarted.sessionPersistence.open(id!, 'read')
    try {
      const stored = await reopened.read()
      const restored = Session.create(id!, stored.events, header)
      expect(JSON.stringify(restored.deriveMessages())).toContain('I remember cobalt')
      expect(JSON.stringify(restored.deriveMessages())).toContain('Continued in DSH')
    } finally { await reopened.close() }
  })
})

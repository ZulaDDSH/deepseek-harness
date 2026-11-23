import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PROTOCOL_VERSION, type SessionNotification } from '@agentclientprotocol/sdk'
import { brandString } from '@deepseek-ai/dsh-brand'
import { SessionSeq, type Session, type SessionEvent, type SessionId } from '@deepseek-ai/dsh-session'
import { AcpSession } from '../src/session.ts'
import { makeBridgeHarness, textResponse, type BridgeHarness } from './harness.ts'

type Notify = (notification: SessionNotification) => Promise<void>

describe('ACP update delivery failure', () => {
  let harness: BridgeHarness | undefined
  let record: AcpSession | undefined

  afterEach(async () => {
    const open = record
    const bridge = harness
    record = undefined
    harness = undefined
    await open?.close('test cleanup').catch(() => undefined)
    await bridge?.dispose()
  })

  async function open(
    notify: Notify,
    onOutputFailure: (error: Error) => void,
    limits?: { updateTimeoutMs?: number; maxPendingUpdateBytes?: number },
  ): Promise<AcpSession> {
    harness = await makeBridgeHarness({ script: [textResponse('hello')] })
    const ctx = harness.ctx
    const created = await AcpSession.create(ctx, {
      sessionId: brandString<SessionId>(randomUUID()),
      cwd: process.cwd(),
      mcpServers: [],
      agentOptions: { provider: 'mock', model: 'mock' },
      signal: new AbortController().signal,
      notify,
      onOutputFailure,
      ...limits === undefined ? {} : { limits },
    })
    ctx.on('session/event', (session, event) => {
      if (created.ownsSession(session)) created.onSessionEvent(session, event)
    })
    ctx.on('agent/inbox/claimed', ({ agent, message, turn }) => {
      if (created.owns(agent)) created.onInboxClaimed(message, turn)
    })
    ctx.on('agent/status', ({ agent, status }) => {
      if (created.owns(agent)) created.onAgentStatus(status)
    })
    ctx.on('agent/error', ({ agent, error }) => {
      if (created.owns(agent)) created.onAgentError(error)
    })
    record = created
    return created
  }

  function toolCallEvent(callId: string): SessionEvent {
    return {
      type: 'tool/call',
      surfaceOp: 'append',
      seq: SessionSeq(0),
      time: 0,
      data: { callId, name: 'probe', arguments: '{}', turn: 1, step: 1 },
    } as SessionEvent
  }

  const promptParams = (created: AcpSession) => ({ sessionId: created.agent.session.id, prompt: [{ type: 'text' as const, text: 'go' }] })

  it('rejects the prompt when an assistant update cannot be delivered', async () => {
    const failures: Error[] = []
    const created = await open(
      ({ update }) => update.sessionUpdate === 'agent_message_chunk' ? Promise.reject(new Error('write failed')) : Promise.resolve(),
      error => failures.push(error),
    )

    await expect(created.prompt(promptParams(created), false)).rejects.toThrow(/assistant output delivery failed: write failed/)
    expect(failures).toEqual([])
  })

  it('keeps tool update failures optional for the prompt', async () => {
    const created = await open(
      ({ update }) => update.sessionUpdate === 'tool_call' ? Promise.reject(new Error('write failed')) : Promise.resolve(),
      () => undefined,
    )
    const warn = vi.spyOn(harness!.ctx.logger, 'warn')
    created.onSessionEvent(created.agent.session as Session, toolCallEvent('call-1'))

    await expect(created.prompt(promptParams(created), false)).resolves.toEqual({ stopReason: 'end_turn' })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('tool-call update delivery failed'))
  })

  it('closes the transport and settles the prompt when a notification never settles', async () => {
    const failures: Error[] = []
    const created = await open(() => new Promise<void>(() => undefined), error => failures.push(error), { updateTimeoutMs: 50 })

    await expect(created.prompt(promptParams(created), false)).rejects.toThrow(/assistant output delivery failed: ACP update delivery timed out/)
    expect(failures).toHaveLength(1)
    expect(failures[0]!.message).toContain('timed out')
    await created.drainUpdates()
    await expect(created.close('done')).resolves.toBeUndefined()
    expect(harness!.ctx.agents.get(created.agent.id)).toBeUndefined()
  })

  it('fails the transport when queued update bytes exceed the cap', async () => {
    const failures: Error[] = []
    const created = await open(() => new Promise<void>(() => undefined), error => failures.push(error), {
      updateTimeoutMs: 300,
      maxPendingUpdateBytes: 150,
    })

    created.onSessionEvent(created.agent.session as Session, toolCallEvent('call-1'))
    created.onSessionEvent(created.agent.session as Session, toolCallEvent('call-2'))
    expect(failures).toEqual([])
    created.onSessionEvent(created.agent.session as Session, toolCallEvent('call-3'))

    expect(failures).toHaveLength(1)
    expect(failures[0]!.message).toContain('backlog exceeds 150 bytes')
    await expect(created.drainUpdates()).resolves.toBeUndefined()
  })
})

describe('ACP bridge transport failure', () => {
  let harness: BridgeHarness | undefined

  afterEach(async () => {
    const bridge = harness
    harness = undefined
    await bridge?.dispose()
  })

  it('reports an assistant update lost to a closed transport instead of swallowing it', async () => {
    harness = await makeBridgeHarness({ script: [textResponse('hello')] })
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const { sessionId } = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })
    const warn = vi.spyOn(harness.ctx.logger, 'warn')
    const bridge = harness
    harness.ctx.on('agent/status', ({ status }) => {
      if (status === 'running') bridge.agentOutputError = new Error('agent transport failed')
    })

    void harness.client.prompt({ sessionId, prompt: [{ type: 'text', text: 'go' }] }).catch(() => undefined)

    await vi.waitFor(() => { expect(warn).toHaveBeenCalledWith(expect.stringContaining('assistant output delivery failed')) })
  })
})

import { describe, expect, it, vi } from 'vitest'
import { apply, Config, MC_RELAY_LIMIT, MC_SEND_WAIT_MS } from '../src/index.ts'

interface FakeAgent {
  id: string
  status: 'idle' | 'running'
  session: {
    header: { cwd?: string }
    snapshotEvents: () => readonly unknown[]
  }
  options: Record<string, unknown>
  steer: ReturnType<typeof vi.fn>
  cancel: ReturnType<typeof vi.fn>
  whenIdle: ReturnType<typeof vi.fn>
}

function agent(id: string, over: Partial<FakeAgent> = {}): FakeAgent {
  return {
    id,
    status: 'idle',
    session: {
      header: {},
      snapshotEvents: vi.fn(() => []),
    },
    options: {},
    steer: vi.fn(),
    cancel: vi.fn(),
    whenIdle: vi.fn(async () => undefined),
    ...over,
  }
}

function setup(config: Partial<Config>, agents: FakeAgent[]) {
  const tools: Record<string, { execute(args: unknown, exec: unknown): Promise<unknown> }> = {}
  const sessionQuery = {
    observeSession: async (id: string) => ({
      events: agents.find(a => a.id === id)?.session.snapshotEvents() ?? [],
      [Symbol.dispose]: () => undefined,
    }),
  }
  const ctx = {
    tools: { register: (t: { name: string }) => { tools[t.name] = t as never } },
    agents: { get: (id: string) => agents.find(a => a.id === id), list: () => agents },
    sessionQuery,
  } as never
  apply(ctx, { managedAll: false, managed: [], ...config })
  return tools
}

const signal = new AbortController().signal

function assistantEvents(text: string) {
  return [
    { type: 'assistant/message', data: { stream: [], message: { content: [{ type: 'text', text }] } } },
  ]
}

/** One complete turn: its start, one claimed user message, an optional reply, and its ending. */
function turnEvents(turn: number, caller: string | undefined, reply: string | undefined, reason: unknown = { kind: 'completed' }) {
  const base = (turn - 1) * 10
  const relay = caller === undefined
    ? { role: 'user', id: `human-${turn}`, content: [{ type: 'text', text: 'human prompt' }], source: { kind: 'user' } }
    : {
      role: 'user',
      id: `relay-${turn}`,
      content: [{ type: 'text', text: `Agent ${caller} sent a message: hi` }],
      source: { kind: 'agent-message', form: 'relay', senderSessionId: caller },
    }
  return [
    { type: 'turn/start', seq: base, time: base, data: { turn } },
    { type: 'user/message', seq: base + 1, time: base + 1, data: relay },
    ...reply === undefined ? [] : [{
      type: 'assistant/message',
      seq: base + 2,
      time: base + 2,
      data: { turn, step: 0, message: { role: 'assistant', id: `answer-${turn}`, content: [{ type: 'text', text: reply }] }, stream: [] },
    }],
    { type: 'turn/end', seq: base + 3, time: base + 3, data: { turn, reason } },
  ]
}

/** A settled `mc_send` call followed by its recorded result. */
function settledRelay(index: number, target: string, time: number, isError = false) {
  const callId = `relay-${index}`
  return [
    {
      type: 'tool/call',
      seq: index * 2,
      time,
      data: { turn: 1, step: 0, callId, name: 'mc_send', arguments: JSON.stringify({ session_id: target, message: 'hi' }) },
    },
    {
      type: 'tool/result',
      seq: index * 2 + 1,
      time,
      data: {
        turn: 1,
        step: 0,
        message: { role: 'tool', id: `result-${index}`, content: [], source: { kind: 'tool', callId }, toolCallId: callId },
        ...isError ? { error: { name: 'tool_error', code: 'E_RELAY' } } : {},
      },
    },
  ]
}

describe('tool-master-control', () => {
  it('lists enrolled peers with last_reply excerpts', async () => {
    const master = agent('m')
    const a = agent('a', {
      status: 'running',
      session: {
        header: { cwd: '/w' },
        snapshotEvents: vi.fn(() => assistantEvents('hello from a')),
      },
    })
    const tools = setup({ managed: ['a'] }, [master, a, agent('b')])
    expect(await tools.mc_list_sessions!.execute({}, { agent: master, signal })).toEqual([
      { id: 'a', status: 'running', cwd: '/w', last_reply: 'hello from a' },
    ])
  })

  it('allows peer send and interrupt without root depth', async () => {
    const peer = agent('p')
    const a = agent('a')
    const tools = setup({ managed: ['a'] }, [peer, a])
    await tools.mc_send!.execute({ session_id: 'a', message: 'hi' }, { agent: peer, signal })
    expect(a.steer).toHaveBeenCalledOnce()
    const msg = a.steer.mock.calls[0]![0] as { content: { text: string }[] }
    expect(msg.content[0]!.text).toContain('Agent p sent a message: hi')
    await tools.mc_interrupt!.execute({ session_id: 'a' }, { agent: peer, signal })
    expect(a.cancel).toHaveBeenCalledWith({ kind: 'parent' })
  })

  it('waits for idle and returns the reply of the delivered message turn', async () => {
    const master = agent('m')
    const log = [...turnEvents(1, undefined, 'old answer')]
    const a = agent('a', {
      session: { header: {}, snapshotEvents: vi.fn(() => log) },
      whenIdle: vi.fn(async () => { log.push(...turnEvents(2, 'm', 'new answer')) }),
    })
    const tools = setup({ managedAll: true }, [master, a])
    await expect(tools.mc_send!.execute(
      { session_id: 'a', message: 'hi', wait: true },
      { agent: master, signal },
    )).resolves.toEqual({ delivered: true, reply: 'new answer' })
    expect(a.whenIdle).toHaveBeenCalledOnce()
  })

  it('reports the failed delivered turn instead of the previous reply', async () => {
    const master = agent('m')
    const log = [...turnEvents(1, undefined, 'old answer')]
    const a = agent('a', {
      session: { header: {}, snapshotEvents: vi.fn(() => log) },
      whenIdle: vi.fn(async () => {
        log.push(...turnEvents(2, 'm', undefined, { kind: 'error', error: { message: 'model down' } }))
      }),
    })
    const tools = setup({ managedAll: true }, [master, a])
    await expect(tools.mc_send!.execute(
      { session_id: 'a', message: 'hi', wait: true },
      { agent: master, signal },
    )).resolves.toEqual({
      delivered: true,
      note: 'the target\'s turn ended with an error (model down) before replying',
    })
  })

  it('reports a cancelled turn and an unconsumed message without an old reply', async () => {
    const master = agent('m')
    const cancelled = [...turnEvents(1, undefined, 'old answer')]
    const cancelling = agent('a', {
      session: { header: {}, snapshotEvents: vi.fn(() => cancelled) },
      whenIdle: vi.fn(async () => {
        cancelled.push(...turnEvents(2, 'm', undefined, { kind: 'aborted', reason: { kind: 'parent' } }))
      }),
    })
    const all = setup({ managedAll: true }, [master, cancelling])
    await expect(all.mc_send!.execute(
      { session_id: 'a', message: 'hi', wait: true },
      { agent: master, signal },
    )).resolves.toEqual({
      delivered: true,
      note: 'the target\'s turn ended with a cancellation (parent) before replying',
    })

    const ignored = agent('b', {
      session: { header: {}, snapshotEvents: vi.fn(() => [...turnEvents(1, undefined, 'old answer')]) },
    })
    const quiet = setup({ managedAll: true }, [master, ignored])
    const result = await quiet.mc_send!.execute(
      { session_id: 'b', message: 'hi', wait: true },
      { agent: master, signal },
    )
    expect(result).toEqual({
      delivered: true,
      note: 'the target went idle without running the message; it may have been cancelled or is still queued',
    })
  })

  it('refuses a wait cycle instead of blocking until the timeout', async () => {
    const master = agent('m')
    const waiting = agent('a', {
      session: {
        header: {},
        snapshotEvents: vi.fn(() => [{
          type: 'tool/call',
          seq: 0,
          time: 1,
          data: { turn: 1, step: 0, callId: 'pending', name: 'mc_send', arguments: JSON.stringify({ session_id: 'm', wait: true }) },
        }]),
      },
    })
    const tools = setup({ managedAll: true }, [master, waiting])
    await expect(tools.mc_send!.execute(
      { session_id: 'a', message: 'hi', wait: true },
      { agent: master, signal },
    )).rejects.toThrow('wait cycle')
    expect(waiting.whenIdle).not.toHaveBeenCalled()
    expect(waiting.steer).not.toHaveBeenCalled()
  })

  it('refuses a relay loop that repeats one peer inside the window', async () => {
    const now = Date.now()
    const log = Array.from({ length: MC_RELAY_LIMIT }, (_, index) => settledRelay(index, 'a', now - 1_000)).flat()
    const master = agent('m', { session: { header: {}, snapshotEvents: vi.fn(() => log) } })
    const a = agent('a')
    const tools = setup({ managedAll: true }, [master, a])
    await expect(tools.mc_send!.execute(
      { session_id: 'a', message: 'hi' },
      { agent: master, signal },
    )).rejects.toThrow('message loop')
    expect(a.steer).not.toHaveBeenCalled()
  })

  it('rejects non-enrolled targets, self, missing callers, and wait timeouts', async () => {
    const master = agent('m')
    const tools = setup({ managed: ['a'] }, [master, agent('a'), agent('b')])
    const send = (id: string, caller: unknown) => tools.mc_send!.execute({ session_id: id, message: 'x' }, { agent: caller, signal })
    await expect(send('b', master)).rejects.toThrow('not enrolled')
    await expect(send('a', undefined)).rejects.toThrow('calling agent')
    const all = setup({ managedAll: true }, [master])
    await expect(all.mc_send!.execute({ session_id: 'm', message: 'x' }, { agent: master, signal })).rejects.toThrow('itself')
    await expect(all.mc_send!.execute({ session_id: 'zz', message: 'x' }, { agent: master, signal })).rejects.toThrow('not loaded')

    vi.useFakeTimers()
    const slow = agent('slow', { whenIdle: vi.fn(() => new Promise(() => undefined)) })
    const waiting = setup({ managedAll: true }, [master, slow])
    const pending = waiting.mc_send!.execute(
      { session_id: 'slow', message: 'x', wait: true },
      { agent: master, signal },
    )
    const expectation = expect(pending).rejects.toThrow('timed out')
    await vi.advanceTimersByTimeAsync(MC_SEND_WAIT_MS)
    await expectation
    vi.useRealTimers()
  })

  it('counts only delivered relays inside the window when detecting loops', async () => {
    const now = Date.now()
    const log = [
      ...Array.from({ length: MC_RELAY_LIMIT }, (_, index) => settledRelay(index, 'a', now - 120_000)).flat(),
      ...Array.from({ length: MC_RELAY_LIMIT }, (_, index) => settledRelay(index + 20, 'a', now, true)).flat(),
      { type: 'tool/call', seq: 900, time: now, data: { turn: 1, step: 0, callId: 'other', name: 'read', arguments: '{}' } },
      { type: 'tool/call', seq: 901, time: now, data: { turn: 1, step: 0, callId: 'bad-json', name: 'mc_send', arguments: '{' } },
      { type: 'tool/call', seq: 902, time: now, data: { turn: 1, step: 0, callId: 'null-json', name: 'mc_send', arguments: 'null' } },
      { type: 'tool/call', seq: 903, time: now, data: { turn: 1, step: 0, callId: 'numeric', name: 'mc_send', arguments: JSON.stringify({ session_id: 7 }) } },
      { type: 'tool/result', seq: 904, time: now, data: { turn: 1, step: 0, message: { role: 'tool', id: 'orphan', content: [], source: { kind: 'tool', callId: 'orphan' }, toolCallId: 'orphan' } } },
      { type: 'tool/result', seq: 905, time: now, data: { turn: 1, step: 0, message: { role: 'tool', id: 'numeric-result', content: [], source: { kind: 'tool', callId: 'numeric' }, toolCallId: 'numeric' } } },
    ]
    const master = agent('m', { session: { header: {}, snapshotEvents: vi.fn(() => log) } })
    const tools = setup({ managedAll: true }, [master, agent('a')])
    await expect(tools.mc_send!.execute({ session_id: 'a', message: 'hi' }, { agent: master, signal }))
      .resolves.toEqual({ delivered: true })
  })

  it('finds multi-hop wait cycles and treats broken wait chains as safe', async () => {
    const master = agent('m')
    const call = (callId: string, target: string, wait: boolean, seq: number) => ({
      type: 'tool/call', seq, time: seq, data: { turn: 1, step: 0, callId, name: 'mc_send', arguments: JSON.stringify({ session_id: target, wait }) },
    })
    const result = (callId: string, seq: number) => ({
      type: 'tool/result', seq, time: seq, data: { turn: 1, step: 0, message: { role: 'tool', id: `r-${callId}`, content: [], source: { kind: 'tool', callId }, toolCallId: callId } },
    })
    const a = agent('a', {
      session: { header: {}, snapshotEvents: vi.fn(() => [call('settled', 'x', true, 0), result('settled', 1), call('plain', 'y', false, 2), call('pending', 'b', true, 3)]) },
    })
    const b = agent('b', { session: { header: {}, snapshotEvents: vi.fn(() => [call('to-m', 'm', true, 0)]) } })
    const tools = setup({ managedAll: true }, [master, a, b])
    await expect(tools.mc_send!.execute({ session_id: 'a', message: 'hi', wait: true }, { agent: master, signal }))
      .rejects.toThrow('a -> b -> m')

    const crossing = agent('a2', { session: { header: {}, snapshotEvents: vi.fn(() => [call('to-b2', 'b2', true, 0)]) } })
    const b2 = agent('b2', { session: { header: {}, snapshotEvents: vi.fn(() => [call('to-a2', 'a2', true, 0)]) } })
    const pairing = setup({ managedAll: true }, [master, crossing, b2])
    await expect(pairing.mc_send!.execute({ session_id: 'a2', message: 'hi', wait: true }, { agent: master, signal }))
      .resolves.toEqual({ delivered: true, note: 'the target went idle without running the message; it may have been cancelled or is still queued' })

    const broken = agent('a3', { session: { header: {}, snapshotEvents: vi.fn(() => [call('to-gone', 'not-loaded', true, 0)]) } })
    const third = setup({ managedAll: true }, [master, broken])
    await expect(third.mc_send!.execute({ session_id: 'a3', message: 'hi', wait: true }, { agent: master, signal }))
      .resolves.toEqual({ delivered: true, note: 'the target went idle without running the message; it may have been cancelled or is still queued' })
  })

  it('reports turns that completed without text, never started, or have not settled', async () => {
    const master = agent('m')
    const noText = [...turnEvents(1, undefined, 'old answer')]
    const noTextAgent = agent('a', {
      session: { header: {}, snapshotEvents: vi.fn(() => noText) },
      whenIdle: vi.fn(async () => { noText.push(...turnEvents(2, 'm', undefined)) }),
    })
    const first = setup({ managedAll: true }, [master, noTextAgent])
    await expect(first.mc_send!.execute({ session_id: 'a', message: 'hi', wait: true }, { agent: master, signal }))
      .resolves.toEqual({ delivered: true, note: 'the target\'s turn completed without a text reply' })

    const blocked = [...turnEvents(1, undefined, 'old answer')]
    const blockedAgent = agent('a', {
      session: { header: {}, snapshotEvents: vi.fn(() => blocked) },
      whenIdle: vi.fn(async () => { blocked.push(...turnEvents(2, 'm', undefined, { kind: 'blocked' })) }),
    })
    const second = setup({ managedAll: true }, [master, blockedAgent])
    await expect(second.mc_send!.execute({ session_id: 'a', message: 'hi', wait: true }, { agent: master, signal }))
      .resolves.toEqual({ delivered: true, note: 'the target\'s turn ended with blocked before replying' })

    const bare = [...turnEvents(1, undefined, 'old answer')]
    const bareAgent = agent('a', {
      session: { header: {}, snapshotEvents: vi.fn(() => bare) },
      whenIdle: vi.fn(async () => {
        bare.push(
          { type: 'turn/start', seq: 90, time: 90, data: { turn: 2 } },
          { type: 'user/message', seq: 91, time: 91, data: { role: 'user', id: 'r2', content: [{ type: 'text', text: 'hi' }], source: { kind: 'agent-message', form: 'relay', senderSessionId: 'm' } } },
        )
      }),
    })
    const third = setup({ managedAll: true }, [master, bareAgent])
    await expect(third.mc_send!.execute({ session_id: 'a', message: 'hi', wait: true }, { agent: master, signal }))
      .resolves.toEqual({ delivered: true, note: 'the message\'s turn has not settled' })

    const stray = [] as Array<Record<string, unknown>>
    const strayAgent = agent('a', {
      session: { header: {}, snapshotEvents: vi.fn(() => stray) },
      whenIdle: vi.fn(async () => {
        stray.push(
          { type: 'user/message', seq: 0, time: 0, data: { role: 'user', id: 'human', content: [{ type: 'text', text: 'human' }], source: { kind: 'user' } } },
          { type: 'user/message', seq: 1, time: 1, data: { role: 'user', id: 'other', content: [{ type: 'text', text: 'other' }], source: { kind: 'agent-message', form: 'relay', senderSessionId: 'not-the-caller' } } },
          { type: 'user/message', seq: 2, time: 2, data: { role: 'user', id: 'relay', content: [{ type: 'text', text: 'hi' }], source: { kind: 'agent-message', form: 'relay', senderSessionId: 'm' } } },
        )
      }),
    })
    const fourth = setup({ managedAll: true }, [master, strayAgent])
    await expect(fourth.mc_send!.execute({ session_id: 'a', message: 'hi', wait: true }, { agent: master, signal }))
      .resolves.toEqual({ delivered: true, note: 'the target recorded no turn for the message' })
  })
})

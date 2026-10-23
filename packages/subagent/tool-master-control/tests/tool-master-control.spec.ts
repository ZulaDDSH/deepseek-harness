import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { apply, Config, MC_SEND_WAIT_MS } from '../src/index.ts'

interface FakeAgent {
  id: string
  status: 'idle' | 'running'
  session: {
    header: { cwd?: string }
    snapshotEvents: ReturnType<typeof vi.fn>
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
  const ctx = {
    tools: { register: (t: { name: string }) => { tools[t.name] = t as never } },
    agents: { get: (id: string) => agents.find(a => a.id === id), list: () => agents },
  } as unknown as Context
  apply(ctx, { managedAll: false, managed: [], ...config })
  return tools
}

const signal = new AbortController().signal

function assistantEvents(text: string) {
  return [
    { type: 'assistant/message', data: { stream: [], message: { content: [{ type: 'text', text }] } } },
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

  it('waits for idle and returns reply when wait=true', async () => {
    const master = agent('m')
    const a = agent('a', {
      whenIdle: vi.fn(async () => undefined),
      session: {
        header: {},
        snapshotEvents: vi.fn(() => assistantEvents('done')),
      },
    })
    const tools = setup({ managedAll: true }, [master, a])
    await expect(tools.mc_send!.execute(
      { session_id: 'a', message: 'go', wait: true },
      { agent: master, signal },
    )).resolves.toEqual({ delivered: true, reply: 'done' })
    expect(a.whenIdle).toHaveBeenCalledOnce()
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
})

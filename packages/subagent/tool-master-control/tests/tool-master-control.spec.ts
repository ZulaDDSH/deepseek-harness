import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { apply, Config } from '../src/index.ts'

interface FakeAgent {
  id: string
  status: 'idle' | 'running'
  session: { header: { cwd?: string; delegationDepth?: number } }
  options: Record<string, unknown>
  steer: ReturnType<typeof vi.fn>
  cancel: ReturnType<typeof vi.fn>
}

function agent(id: string, over: Partial<FakeAgent> = {}): FakeAgent {
  return { id, status: 'idle', session: { header: {} }, options: {}, steer: vi.fn(), cancel: vi.fn(), ...over }
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

describe('tool-master-control', () => {
  it('lists only enrolled sessions other than the caller', async () => {
    const master = agent('m')
    const tools = setup({ managed: ['a'] }, [master, agent('a', { status: 'running' }), agent('b')])
    expect(await tools.mc_list_sessions!.execute({}, { agent: master, signal })).toEqual([
      { id: 'a', status: 'running' },
    ])
  })

  it('steers an enrolled session and interrupts it', async () => {
    const master = agent('m')
    const a = agent('a')
    const tools = setup({ managed: ['a'] }, [master, a])
    await tools.mc_send!.execute({ session_id: 'a', message: 'hi' }, { agent: master, signal })
    expect(a.steer).toHaveBeenCalledOnce()
    await tools.mc_interrupt!.execute({ session_id: 'a' }, { agent: master, signal })
    expect(a.cancel).toHaveBeenCalledWith({ kind: 'parent' })
  })

  it('rejects non-enrolled targets, self, non-root callers and missing callers', async () => {
    const master = agent('m')
    const child = agent('c', { session: { header: { delegationDepth: 1 } } })
    const tools = setup({ managed: ['a'] }, [master, agent('a'), agent('b'), child])
    const send = (id: string, caller: unknown) => tools.mc_send!.execute({ session_id: id, message: 'x' }, { agent: caller, signal })
    await expect(send('b', master)).rejects.toThrow('not enrolled')
    await expect(send('a', child)).rejects.toThrow('root')
    await expect(send('a', undefined)).rejects.toThrow('calling agent')
    const all = setup({ managedAll: true }, [master])
    await expect(all.mc_send!.execute({ session_id: 'm', message: 'x' }, { agent: master, signal })).rejects.toThrow('itself')
    await expect(all.mc_send!.execute({ session_id: 'zz', message: 'x' }, { agent: master, signal })).rejects.toThrow('not loaded')
  })
})

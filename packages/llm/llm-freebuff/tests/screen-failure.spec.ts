import { describe, expect, it, vi } from 'vitest'
import { collect, failureOf, harness, userMessage } from './harness.ts'

vi.mock('../src/screen.ts', async importOriginal => ({
  ...await importOriginal<typeof import('../src/screen.ts')>(),
  FreebuffScreen: vi.fn(function FreebuffScreen() { throw new Error('the headless terminal is not installed') }),
}))

describe('Freebuff terminal without a screen', () => {
  it('stops the terminal it started when the screen cannot be created, even if stopping fails', async () => {
    const h = await harness()
    h.host.script = { failStop: true }
    const result = await collect(h, h.session('s1', h.workspace('proj')), [userMessage('go')])
    expect(failureOf(result).message).toContain('headless terminal is not installed')
    expect(h.host.killed).toBe(1)
    expect(h.host.spawns[0]!.signal?.aborted).toBe(true)
    expect(h.pool().session('s1').occupied).toBe(false)
  })
})

/**
 * Unit coverage for the seam's out-of-process provider vocabulary: cwd
 * resolution against the real filesystem, and the settlement/handle helpers
 * under their never-reject and idempotence contracts.
 */

import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import {
  assertPositiveFinite,
  assertUsableCwd,
  boundedProgress,
  NO_START_CAPABILITIES,
  resolveParentSandboxMode,
  runTimeLimit,
  settleRunResult,
  subprocessRunHandle,
} from '../src/index.ts'

describe('NO_START_CAPABILITIES', () => {
  it('advertises nothing and is frozen (shared by every out-of-process backend)', () => {
    expect(NO_START_CAPABILITIES).toEqual({
      agentOptions: false,
      agentPreset: false,
      outputSchema: false,
      depthLimit: false,
    })
    expect(Object.isFrozen(NO_START_CAPABILITIES)).toBe(true)
  })
})

describe('assertPositiveFinite', () => {
  it('accepts positive finite bounds and rejects zero, negatives, and NaN', () => {
    expect(() => { assertPositiveFinite('p', 'graceMs', 1) }).not.toThrow()
    expect(() => { assertPositiveFinite('p', 'graceMs', 0) }).toThrow('p: graceMs must be a positive finite number')
    expect(() => { assertPositiveFinite('p', 'graceMs', -5) }).toThrow('positive finite')
    expect(() => { assertPositiveFinite('p', 'graceMs', Number.NaN) }).toThrow('positive finite')
    expect(() => { assertPositiveFinite('p', 'graceMs', Number.POSITIVE_INFINITY) }).toThrow('positive finite')
  })
})

describe('child cwd resolution', () => {
  it('accepts an absolute enterable directory and rejects relative or missing paths', () => {
    expect(assertUsableCwd('p', 'config cwd', tmpdir())).toBe(tmpdir())
    expect(() => assertUsableCwd('p', 'config cwd', 'relative/path')).toThrow('must be an absolute path')
    expect(() => assertUsableCwd('p', 'config cwd', join(tmpdir(), 'dsh-no-such-dir-xyz'))).toThrow('not an accessible directory')
  })

  it('rejects an existing path that is a file, not a directory', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'oop-file-'))
    const file = join(tmp, 'plain.txt')
    try {
      writeFileSync(file, 'not a dir\n')
      expect(() => assertUsableCwd('p', 'config cwd', file)).toThrow('not an accessible directory')
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  // Windows ACLs do not expose the POSIX directory search-bit state this fixture creates.
  it.skipIf(process.platform === 'win32')('rejects a directory without search permission', () => {
    // statSync().isDirectory() is true for a mode-600 directory, but a
    // subprocess cwd needs SEARCH permission — spawn would fail EACCES.
    const tmp = mkdtempSync(join(tmpdir(), 'oop-noexec-'))
    chmodSync(tmp, 0o600)
    try {
      expect(() => assertUsableCwd('p', 'config cwd', tmp)).toThrow('not an accessible directory')
    } finally {
      chmodSync(tmp, 0o700)
      rmSync(tmp, { recursive: true, force: true })
    }
  })



})

describe('settleRunResult', () => {
  const wiring = () => {
    const controller = new AbortController()
    const onAbort = vi.fn()
    controller.signal.addEventListener('abort', onAbort)
    return { controller, onAbort }
  }

  it('passes a successful attempt through and removes the abort listener', async () => {
    const { controller, onAbort } = wiring()
    const result = await settleRunResult({
      attempt: async () => ({ output: [{ type: 'text', text: 'done' }], stopReason: 'completed' }),
      collectOutput: () => [],
      cancelled: () => false,
      signal: controller.signal,
      onAbort,
    })
    expect(result.stopReason).toBe('completed')
    controller.abort()
    // The listener was removed at settlement, so the abort never reaches it.
    expect(onAbort).not.toHaveBeenCalled()
  })

  it('reads an in-flight rejection as aborted when cancellation already settled', async () => {
    const { controller, onAbort } = wiring()
    const result = await settleRunResult({
      attempt: async () => { throw new Error('pipe torn mid-cancel') },
      collectOutput: () => [{ type: 'text', text: 'partial' }],
      cancelled: () => true,
      signal: controller.signal,
      onAbort,
    })
    expect(result).toEqual({ output: [{ type: 'text', text: 'partial' }], stopReason: 'aborted' })
  })

  it('flattens a failure through a contained onError sink', async () => {
    const { controller, onAbort } = wiring()
    const seen: string[] = []
    const result = await settleRunResult({
      attempt: async () => { throw new Error('transport died') },
      collectOutput: () => [],
      cancelled: () => false,
      onError: (error, stopReason) => {
        seen.push(`${stopReason}:${error.message}`)
        throw new Error('sink failure must be contained')
      },
      signal: controller.signal,
      onAbort,
    })
    expect(result.stopReason).toBe('error')
    expect(seen).toEqual(['error:transport died'])
  })

  it('flattens a failure without a sink', async () => {
    const { controller, onAbort } = wiring()
    const result = await settleRunResult({
      attempt: async () => { throw new Error('no sink configured') },
      collectOutput: () => [],
      cancelled: () => false,
      signal: controller.signal,
      onAbort,
    })
    expect(result.stopReason).toBe('error')
  })
})

describe('subprocessRunHandle', () => {
  it('publishes an idempotent dispose that cancels locally and awaits teardown', async () => {
    const controller = new AbortController()
    const onAbort = vi.fn()
    controller.signal.addEventListener('abort', onAbort)
    const requestCancel = vi.fn()
    const teardown = vi.fn(() => Promise.resolve())
    const run = subprocessRunHandle({
      id: SessionId('run-1'),
      result: Promise.resolve({ output: [], stopReason: 'completed' }),
      signal: controller.signal,
      onAbort,
      requestCancel,
      teardown,
    })
    expect(String(run.id)).toBe('run-1')
    const disposal = run.dispose()
    expect(run.dispose()).toBe(disposal)
    await disposal
    expect(requestCancel).toHaveBeenCalledTimes(1)
    expect(teardown).toHaveBeenCalledTimes(1)
    controller.abort()
    // dispose removed the abort listener before cancelling.
    expect(onAbort).not.toHaveBeenCalled()
  })
})

describe('resolveParentSandboxMode', () => {
  it('is undefined without a composed sandbox policy', () => {
    expect(resolveParentSandboxMode(new Context(), {} as never)).toBeUndefined()
  })

  it('resolves the delegating parent session through the composed sandbox policy', () => {
    const ctx = new Context()
    const resolve = vi.fn(() => ({ mode: 'read-only', workspaceRoot: '/w' }))
    ctx.provide('sandboxPolicy', { resolve } as never)
    const session = {} as never
    expect(resolveParentSandboxMode(ctx, session)).toBe('read-only')
    expect(resolve).toHaveBeenCalledWith({ session })
  })
})

describe('boundedProgress', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('passes an absent sink through as absent', () => {
    expect(boundedProgress(undefined)).toBeUndefined()
  })

  it('forwards at most one line per 500 ms window', () => {
    vi.useFakeTimers()
    const sink = vi.fn()
    const bounded = boundedProgress(sink)
    if (bounded === undefined) throw new Error('expected a bounded sink')
    bounded('Edit: src/a.ts')
    bounded('Edit: src/b.ts')
    expect(sink.mock.calls).toEqual([['Edit: src/a.ts']])
    vi.advanceTimersByTime(500)
    bounded('Edit: src/c.ts')
    expect(sink.mock.calls).toEqual([['Edit: src/a.ts'], ['Edit: src/c.ts']])
  })

  it('keeps a 120-character line and truncates a 121-character line to 119 characters plus an ellipsis', () => {
    vi.useFakeTimers()
    const sink = vi.fn()
    const bounded = boundedProgress(sink)
    if (bounded === undefined) throw new Error('expected a bounded sink')
    const exact = 'a'.repeat(120)
    bounded(exact)
    expect(sink).toHaveBeenLastCalledWith(exact)
    vi.advanceTimersByTime(500)
    bounded('b'.repeat(121))
    expect(sink).toHaveBeenLastCalledWith(`${'b'.repeat(119)}…`)
  })

  it('truncates on code-point boundaries', () => {
    vi.useFakeTimers()
    const sink = vi.fn()
    const bounded = boundedProgress(sink)
    if (bounded === undefined) throw new Error('expected a bounded sink')
    bounded('😀'.repeat(130))
    const forwarded = sink.mock.calls[0]?.[0] as string
    expect(Array.from(forwarded)).toHaveLength(120)
    expect(forwarded.endsWith('…')).toBe(true)
  })

  it('contains a throwing sink', () => {
    vi.useFakeTimers()
    const bounded = boundedProgress(() => { throw new Error('sink failed') })
    if (bounded === undefined) throw new Error('expected a bounded sink')
    expect(() => { bounded('Edit: src/a.ts') }).not.toThrow()
  })
})

describe('runTimeLimit', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('never fires without a timeout', () => {
    vi.useFakeTimers()
    const onTimeout = vi.fn()
    const limit = runTimeLimit(undefined, onTimeout, () => new Error('exceeded'))
    vi.advanceTimersByTime(60 * 60_000)
    expect(limit.timedOut()).toBe(false)
    expect(onTimeout).not.toHaveBeenCalled()
    limit.clear()
  })

  it('fires once at the deadline and rejects the expiry with the failure', async () => {
    vi.useFakeTimers()
    const onTimeout = vi.fn()
    const failure = new Error('exceeded timeoutMs (1000 ms)')
    const limit = runTimeLimit(1000, onTimeout, () => failure)
    vi.advanceTimersByTime(999)
    expect(onTimeout).not.toHaveBeenCalled()
    expect(limit.timedOut()).toBe(false)
    vi.advanceTimersByTime(1)
    expect(onTimeout).toHaveBeenCalledTimes(1)
    expect(limit.timedOut()).toBe(true)
    await expect(limit.expired).rejects.toBe(failure)
    vi.advanceTimersByTime(5000)
    expect(onTimeout).toHaveBeenCalledTimes(1)
  })

  it('never fires when cleared before the deadline', () => {
    vi.useFakeTimers()
    const onTimeout = vi.fn()
    const limit = runTimeLimit(1000, onTimeout, () => new Error('exceeded'))
    limit.clear()
    limit.clear()
    vi.advanceTimersByTime(5000)
    expect(onTimeout).not.toHaveBeenCalled()
    expect(limit.timedOut()).toBe(false)
  })
})

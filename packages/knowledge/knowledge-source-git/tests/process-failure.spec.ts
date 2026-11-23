import { ChildProcess, spawn } from 'node:child_process'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveGitSource } from '../src/index.ts'

vi.mock('node:child_process', async original => ({
  ...await original<typeof import('node:child_process')>(), spawn: vi.fn(),
}))
afterEach(() => { vi.resetAllMocks() })

function finished(code: number | null, stdout = '', stderr = '', error?: Error): ChildProcess {
  const child = Object.assign(new ChildProcess(), { stdout: new PassThrough(), stderr: new PassThrough() })
  queueMicrotask(() => {
    child.stdout.write(stdout)
    child.stderr.write(stderr)
    if (error !== undefined) child.emit('error', error)
    child.emit('close', code)
  })
  return child
}

function hanging(stdout = ''): ChildProcess {
  const child = Object.assign(new ChildProcess(), { stdout: new PassThrough(), stderr: new PassThrough() })
  vi.spyOn(child, 'kill').mockReturnValue(true)
  if (stdout !== '') queueMicrotask(() => { child.stdout.write(stdout) })
  return child
}

describe('Git knowledge process bounds', () => {
  const source = { repo: './fixture', ref: 'master', paths: [] }

  it('kills the Git child and rejects when the caller aborts', async () => {
    const child = hanging()
    vi.mocked(spawn).mockImplementationOnce(() => child)
    const controller = new AbortController()
    const pending = resolveGitSource(source, { signal: controller.signal })
    controller.abort(new Error('cancelled by caller'))
    await expect(pending).rejects.toThrow('cancelled by caller')
    expect(child.kill).toHaveBeenCalled()
  })

  it('does not start Git for an already aborted signal', async () => {
    await expect(resolveGitSource(source, { signal: AbortSignal.abort(new Error('already aborted')) })).rejects.toThrow('already aborted')
    expect(spawn).not.toHaveBeenCalled()
  })

  it('kills the Git child when the deadline passes', async () => {
    const child = hanging()
    vi.mocked(spawn).mockImplementationOnce(() => child)
    await expect(resolveGitSource(source, { timeoutMs: 20 })).rejects.toThrow(/git rev-parse timed out/)
    expect(child.kill).toHaveBeenCalled()
  })

  it('kills the Git child and rejects when output exceeds the cap', async () => {
    const child = hanging('x'.repeat(100))
    vi.mocked(spawn).mockImplementationOnce(() => child)
    await expect(resolveGitSource(source, { maxOutputBytes: 10 })).rejects.toThrow(/more than 10 bytes of output/)
    expect(child.kill).toHaveBeenCalled()
  })
})

describe('Git knowledge process failures', () => {
  it('reports spawn failures from source inspection', async () => {
    vi.mocked(spawn).mockImplementationOnce(() => finished(null, '', '', new Error('git unavailable')))
    await expect(resolveGitSource({ repo: './fixture', ref: 'master', paths: [] })).rejects.toThrow('git unavailable')
  })

  it('reports a signal termination with no stderr as an unsuccessful checkout', async () => {
    vi.mocked(spawn)
      .mockImplementationOnce(() => finished(0, 'true\n'))
      .mockImplementationOnce(() => finished(0))
      .mockImplementationOnce(() => finished(0))
      .mockImplementationOnce(() => finished(1))
      .mockImplementationOnce(() => finished(1))
      .mockImplementationOnce(() => finished(0, 'a'.repeat(40)))
      .mockImplementationOnce(() => finished(0, 'b'.repeat(40)))
      .mockImplementationOnce(() => finished(null))
    await expect(resolveGitSource({ repo: './fixture', ref: 'master', paths: [] }))
      .rejects.toThrow('git checkout failed: exit code 1')
  })
})

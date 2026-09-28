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

describe('Git knowledge process failures', () => {
  it('reports spawn failures from source inspection', async () => {
    vi.mocked(spawn).mockImplementationOnce(() => finished(null, '', '', new Error('git unavailable')))
    await expect(resolveGitSource({ repo: './fixture', ref: 'master', paths: [] })).rejects.toThrow('git unavailable')
  })

  it('reports a signal termination with no stderr as an unsuccessful checkout', async () => {
    vi.mocked(spawn)
      .mockImplementationOnce(() => finished(0, 'true\n'))
      .mockImplementationOnce(() => finished(0))
      .mockImplementationOnce(() => finished(1))
      .mockImplementationOnce(() => finished(1))
      .mockImplementationOnce(() => finished(0, 'a'.repeat(40)))
      .mockImplementationOnce(() => finished(null))
    await expect(resolveGitSource({ repo: './fixture', ref: 'master', paths: [] }))
      .rejects.toThrow('git checkout failed: exit code 1')
  })
})

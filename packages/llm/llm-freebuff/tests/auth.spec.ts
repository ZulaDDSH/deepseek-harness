import { writeFileSync } from 'node:fs'
import type { AuthorizationInteraction, AuthorizationNotice } from '@deepseek-ai/dsh-authorization'
import { describe, expect, it } from 'vitest'
import { FREEBUFF_KEY } from '../src/auth.ts'
import { doctorStatus } from '../src/doctor.ts'
import { freebuffLaunch } from '../src/launch.ts'
import { harness, scratch } from './harness.ts'

function surface(): AuthorizationInteraction & { notices: AuthorizationNotice[] } {
  const notices: AuthorizationNotice[] = []
  return {
    notices,
    notify: (notice) => { notices.push(notice) },
    prompt: () => Promise.reject(new Error('no prompts expected')),
  }
}

describe('Freebuff sign-in flow', () => {
  it('relays only the first https URL, commits the marker after doctor reports auth.ok', async () => {
    const h = await harness({ signedIn: false })
    const ui = surface()
    const outcome = await h.ctx.authorization.begin({ key: FREEBUFF_KEY, method: 'cli', interaction: ui })
    expect(outcome.status).toBe('authorized')
    expect(ui.notices).toHaveLength(1)
    expect(ui.notices[0]!.url).toBe('https://freebuff.example/login?code=ABC')
    expect(JSON.stringify(ui.notices)).not.toContain('example.com')
    const record = await h.ctx.credentials.describeRecord(FREEBUFF_KEY)
    expect(record.configured).toBe(true)
  })

  it('fails on a non-zero exit without committing, and never echoes the login output', async () => {
    const h = await harness({ loginExit: '3' , signedIn: false })
    const ui = surface()
    await expect(h.ctx.authorization.begin({ key: FREEBUFF_KEY, interaction: ui })).rejects.toThrow('exit code 3')
    expect((await h.ctx.credentials.describeRecord(FREEBUFF_KEY)).configured).toBe(false)
  })

  it('fails when doctor does not report a saved sign-in after a zero exit', async () => {
    const h = await harness({ mode: 'no-save' , signedIn: false })
    await expect(h.ctx.authorization.begin({ key: FREEBUFF_KEY, interaction: surface() })).rejects.toThrow('did not report a saved sign-in')
    expect((await h.ctx.credentials.describeRecord(FREEBUFF_KEY)).configured).toBe(false)
  })

  it('settles as cancelled and stops the login process when the caller aborts', async () => {
    const h = await harness({ mode: 'hang', signedIn: false })
    const abort = new AbortController()
    const ui = surface()
    const original = ui.notify.bind(ui)
    ui.notify = (notice) => {
      original(notice)
      abort.abort()
    }
    const outcome = await h.ctx.authorization.begin({ key: FREEBUFF_KEY, interaction: ui, signal: abort.signal })
    expect(outcome.status).toBe('cancelled')
    expect((await h.ctx.credentials.describeRecord(FREEBUFF_KEY)).configured).toBe(false)
  })

  it('times out a login that never finishes', async () => {
    const h = await harness({ mode: 'hang', signedIn: false, timing: { loginTimeoutMs: 300 } })
    await expect(h.ctx.authorization.begin({ key: FREEBUFF_KEY, interaction: surface() })).rejects.toThrow('timed out')
  })

  it('reports a missing executable as an error before spawning', async () => {
    const h = await harness({ resolveExecutable: () => Promise.reject(new Error('Freebuff CLI was not found')) })
    await expect(h.ctx.authorization.begin({ key: FREEBUFF_KEY, interaction: surface() })).rejects.toThrow('not found')
  })
})

describe('Freebuff marker reconciliation', () => {
  it('writes the marker when doctor says signed in and deletes it when signed out', async () => {
    const h = await harness({ install: false })
    expect(await h.account.reconcile()).toBe('signed-in')
    expect((await h.ctx.credentials.describeRecord(FREEBUFF_KEY)).configured).toBe(true)
    writeFileSync(h.state, 'out')
    expect(await h.account.reconcile()).toBe('signed-out')
    expect((await h.ctx.credentials.describeRecord(FREEBUFF_KEY)).configured).toBe(false)
  })

  it('leaves the marker alone when doctor cannot answer', async () => {
    const h = await harness({ install: false, mode: 'broken' })
    await h.ctx.credentials.modifyRecord(FREEBUFF_KEY, () => Promise.resolve({ kind: 'grant', payload: { via: 'freebuff-cli' } }))
    expect(await h.account.reconcile()).toBe('unknown')
    expect((await h.ctx.credentials.describeRecord(FREEBUFF_KEY)).configured).toBe(true)
  })

  it('treats a missing executable as unknown', async () => {
    const h = await harness({ install: false, resolveExecutable: () => Promise.reject(new Error('missing')) })
    expect(await h.account.reconcile()).toBe('unknown')
  })

  it('reuses a fresh answer inside the TTL and refreshes it when forced', async () => {
    const h = await harness({ install: false, timing: { doctorTtlMs: 60_000 } })
    expect(await h.account.reconcile()).toBe('signed-in')
    writeFileSync(h.state, 'out')
    expect(await h.account.reconcile()).toBe('signed-in')
    expect(await h.account.reconcile(true)).toBe('signed-out')
  })

  it('shares one doctor run between concurrent callers', async () => {
    const h = await harness({ install: false })
    const [a, b] = await Promise.all([h.account.status(), h.account.status()])
    expect([a, b]).toEqual(['signed-in', 'signed-in'])
  })

  it('does not delete the marker while a sign-in attempt for the key is running', async () => {
    const h = await harness({ mode: 'hang', signedIn: false })
    await h.ctx.credentials.modifyRecord(FREEBUFF_KEY, () => Promise.resolve({ kind: 'grant', payload: { via: 'freebuff-cli' } }))
    writeFileSync(h.state, 'out')
    const abort = new AbortController()
    const ui = surface()
    const attempt = h.ctx.authorization.begin({ key: FREEBUFF_KEY, interaction: ui, signal: abort.signal })
    while (ui.notices.length === 0) await new Promise(resolve => setTimeout(resolve, 10))
    expect(await h.account.reconcile(true)).toBe('signed-out')
    expect((await h.ctx.credentials.describeRecord(FREEBUFF_KEY)).configured).toBe(true)
    abort.abort()
    await attempt
  })
})

describe('Freebuff doctor', () => {
  it('maps a spawn failure to unknown', async () => {
    const result = await doctorStatus({
      spawn: () => { throw new Error('no process') },
      executable: 'x',
      args: [],
      env: {},
      cwd: scratch(),
      platform: 'linux',
      comSpec: undefined,
      timeoutMs: 100,
      graceMs: 10,
    })
    expect(result).toBe('unknown')
  })

  it('treats a run without collected output as unknown and honours the caller signal', async () => {
    const result = await doctorStatus({
      spawn: () => ({ done: Promise.resolve(), collected: {} }) as never,
      executable: 'x',
      args: [],
      env: {},
      cwd: scratch(),
      platform: 'linux',
      comSpec: undefined,
      timeoutMs: 100,
      graceMs: 10,
      signal: new AbortController().signal,
    })
    expect(result).toBe('unknown')
  })

  it('falls back to cmd.exe when no command shell is configured', () => {
    const saved = process.env.ComSpec
    delete process.env.ComSpec
    try {
      expect(freebuffLaunch('C:\\f.cmd', ['x'], 'win32', undefined).argv[0]).toBe('cmd.exe')
    } finally {
      if (saved !== undefined) process.env.ComSpec = saved
    }
  })

  it('wraps a Windows shim in cmd with the path in an environment variable', () => {
    const launch = freebuffLaunch('C:\\Users\\a b\\AppData\\Roaming\\npm\\freebuff.cmd', ['doctor', '--json'], 'win32', 'C:\\Windows\\System32\\cmd.exe')
    expect(launch.argv).toEqual(['C:\\Windows\\System32\\cmd.exe', '/d', '/c', '%DSH_FREEBUFF_EXE%', 'doctor', '--json'])
    expect(launch.env).toEqual({ DSH_FREEBUFF_EXE: '"C:\\Users\\a b\\AppData\\Roaming\\npm\\freebuff.cmd"' })
    expect(() => freebuffLaunch('C:\\f.cmd', ['--cwd', 'C:\\a&b'], 'win32', undefined)).toThrow()
    expect(() => freebuffLaunch('C:\\f.cmd', ['--cwd', 'a\nb'], 'win32', undefined)).toThrow()
    expect(() => freebuffLaunch('C:\\f.cmd', ['--cwd', 'a\rb'], 'win32', undefined)).toThrow()
    expect(freebuffLaunch('C:\\f.cmd', ['x'], 'win32', undefined).argv[0]).toBe(process.env.ComSpec ?? 'cmd.exe')
    expect(freebuffLaunch('/usr/bin/freebuff', ['--cwd', 'a&b'], 'linux', undefined)).toEqual({ argv: ['/usr/bin/freebuff', '--cwd', 'a&b'], env: {} })
  })
})

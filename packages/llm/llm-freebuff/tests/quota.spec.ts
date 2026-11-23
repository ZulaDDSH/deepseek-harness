import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { QuotaController } from '@deepseek-ai/dsh-api-quota-controller'
import { describe, expect, it, vi } from 'vitest'
import {
  QUOTA_TTL_MS, SESSION_URL, createFreebuffQuotaSource, credentialTarget, decodeToken, defaultQuotaOptions, hours, hoursMinutes, parseUsage, quotaWindows, runPowerShell, windowsTokenReader, type ExecFile, type RunPowerShell,
} from '../src/quota.ts'
import { harness } from './harness.ts'

const TOKEN = `fake-${'x'.repeat(12)}-value`
const NOW = Date.parse('2026-11-23T10:00:00Z')

function session(overrides: Record<string, unknown> = {}): unknown {
  return {
    freebucks: {
      daily: {
        remaining: 40,
        limit: 80,
        resetAt: '2026-11-24T00:00:00Z',
        openHours: [{ amount: 5, endsAt: '2026-11-23T10:30:00Z' }],
        ...overrides,
      },
      wallet: { monthlyUsage: { remaining: 262, limit: 500 }, nextBonusAt: '2026-12-01T00:00:00Z' },
      prices: { 'fbc/deepseek-flash': 1 },
    },
  }
}

function source(body: unknown = session(), extra: { token?: string | undefined; status?: number; now?: () => number } = {}) {
  const fetchImpl = vi.fn<typeof fetch>(async () => extra.status === undefined || extra.status === 200
    ? Response.json(body)
    : new Response('denied', { status: extra.status }))
  const readToken = vi.fn(async () => 'token' in extra ? extra.token : TOKEN)
  return { fetchImpl, readToken, source: createFreebuffQuotaSource({ readToken, now: extra.now ?? (() => NOW), timeZone: () => 'Europe/London' }) }
}

describe('Freebuff hours math', () => {
  it('floors freebucks to whole hours and shows h:mm', () => {
    expect(hours(80)).toBe(16)
    expect(hours(79.9999999999)).toBe(16)
    expect(hours(-3)).toBe(0)
    expect(hours(79)).toBe(15)
    expect(hours(4)).toBe(0)
    expect(hoursMinutes(40)).toBe('8:00')
    expect(hoursMinutes(7.5)).toBe('1:30')
    expect(hoursMinutes(0.4)).toBe('0:04')
    expect(hoursMinutes(-1)).toBe('0:00')
  })

  it('counts the unused part of each open hour as still left and floors the limit', () => {
    const usage = parseUsage(session({ limit: 82 }))!
    const { daily, monthly } = quotaWindows(usage, NOW)
    expect(daily!.valueLabel).toBe('Today 8:30 left of 16 h, running hour ends in 30 min')
    expect(daily!.resetAt).toBe(Date.parse('2026-11-24T00:00:00Z'))
    expect(daily!.usedPercent).toBeCloseTo((1 - 42.5 / 82) * 100)
    expect(monthly!.valueLabel).toBe('52 of 100 h left')
    expect(monthly!.usedPercent).toBeCloseTo((1 - 262 / 500) * 100)
  })

  it('refunds nothing once an open hour has ended and ignores null or malformed open hours', () => {
    const usage = parseUsage(session({ openHours: [null, { amount: 5, endsAt: '2026-11-23T09:00:00Z' }, { amount: 'x', endsAt: 'bad' }] }))!
    expect(usage.openHours).toHaveLength(1)
    expect(quotaWindows(usage, NOW).daily!.valueLabel).toBe('Today 8:00 left of 16 h')
    expect(parseUsage(session({ openHours: null }))!.openHours).toEqual([])
  })

  it('reports the latest of several running hours', () => {
    const usage = parseUsage(session({ openHours: [{ amount: 5, endsAt: '2026-11-23T10:30:00Z' }, { amount: 5, endsAt: '2026-11-23T11:00:00Z' }, { amount: 5, endsAt: '2026-11-23T10:15:00Z' }] }))!
    expect(quotaWindows(usage, NOW).daily!.valueLabel).toBe('Today 9:45 left of 16 h, running hour ends in 60 min')
  })

  it('clamps usedPercent and omits the monthly window when the wallet is missing', () => {
    const usage = parseUsage({ freebucks: { daily: { remaining: 400, limit: 80 } } })!
    expect(usage.resetAt).toBeNull()
    expect(quotaWindows(usage, NOW)).toEqual({ daily: { usedPercent: 0, resetAt: null, valueLabel: 'Today 80:00 left of 16 h' } })
    const empty = quotaWindows(parseUsage({ freebucks: { daily: { remaining: 0, limit: 0 } } })!, NOW)
    expect(empty.daily!.usedPercent).toBeNull()
  })

  it.each([null, {}, { freebucks: {} }, { freebucks: { daily: { remaining: '40', limit: 80 } } }, { freebucks: { daily: { remaining: 1 } } }])('rejects %j instead of reading zero hours', (body) => {
    expect(parseUsage(body)).toBeUndefined()
  })
})

describe('Freebuff quota source', () => {
  it('reads /session with the bearer token and time zone and reports the windows', async () => {
    const { source: quota, fetchImpl } = source()
    const result = await quota.fetch(fetchImpl)
    expect(result).toMatchObject({ providerId: 'freebuff', providerName: 'Freebuff', configured: true, ok: true, asOf: NOW })
    expect(result.windows!.daily!.valueLabel).toBe('Today 8:30 left of 16 h, running hour ends in 30 min')
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe(SESSION_URL)
    expect(init!.headers).toEqual({ Authorization: `Bearer ${TOKEN}`, 'x-fb-timezone': 'Europe/London' })
    expect(quota.id).toBe('freebuff')
    await expect(quota.configured()).resolves.toBe(true)
  })

  it('is not configured without a credential and never calls the API', async () => {
    const { source: quota, fetchImpl } = source(session(), { token: undefined })
    expect(await quota.fetch(fetchImpl)).toEqual({ providerId: 'freebuff', providerName: 'Freebuff', configured: false, ok: false, error: 'Not configured' })
    expect(fetchImpl).not.toHaveBeenCalled()
    await expect(quota.configured()).resolves.toBe(false)
  })

  it.each([500, 401])('turns HTTP %i into an error state, never zero hours', async (status) => {
    const { source: quota, fetchImpl } = source(session(), { status })
    const result = await quota.fetch(fetchImpl)
    expect(result).toMatchObject({ configured: true, ok: false })
    expect(result.windows).toBeUndefined()
    expect(result.error).toContain(`HTTP ${status}`)
    expect(JSON.stringify(result)).not.toContain(TOKEN)
  })

  it('turns a network failure, a bad body and an unreadable credential into error states without the token', async () => {
    const failing = createFreebuffQuotaSource({ readToken: async () => TOKEN })
    const result = await failing.fetch(async () => { throw new Error(`connect failed for Bearer ${TOKEN}`) })
    expect(result).toEqual({ providerId: 'freebuff', providerName: 'Freebuff', configured: true, ok: false, error: 'Freebuff usage request failed' })
    const bad = await createFreebuffQuotaSource({ readToken: async () => TOKEN }).fetch(async () => Response.json({ freebucks: {} }))
    expect(bad).toMatchObject({ configured: true, ok: false, error: 'Freebuff usage response had no daily hours' })
    const unreadable = createFreebuffQuotaSource({ readToken: async () => { throw new Error('Could not read the Freebuff sign-in from Credential Manager') } })
    expect(await unreadable.fetch(fetch)).toMatchObject({ configured: true, ok: false, error: 'Could not read the Freebuff sign-in from Credential Manager' })
    await expect(unreadable.configured()).resolves.toBe(false)
  })

  it('caches the usage for five minutes, counts the running hour down, and never caches a failure or a signed-out state', async () => {
    let now = NOW
    const { source: quota, fetchImpl, readToken } = source(session(), { now: () => now })
    await quota.fetch(fetchImpl)
    now += QUOTA_TTL_MS - 1
    const later = await quota.fetch(fetchImpl)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(later.windows!.daily!.valueLabel).toBe('Today 8:25 left of 16 h, running hour ends in 25 min')
    now = NOW + QUOTA_TTL_MS
    await quota.fetch(fetchImpl)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    readToken.mockResolvedValueOnce(undefined)
    await quota.fetch(fetchImpl)
    await quota.fetch(fetchImpl)
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    fetchImpl.mockResolvedValueOnce(new Response('x', { status: 503 }))
    now += QUOTA_TTL_MS
    expect((await quota.fetch(fetchImpl)).ok).toBe(false)
    expect((await quota.fetch(fetchImpl)).ok).toBe(true)
  })

  it('never logs the token', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map(level => vi.spyOn(console, level).mockImplementation(() => {}))
    const { source: quota, fetchImpl } = source(session(), { status: 500 })
    await quota.fetch(fetchImpl)
    await quota.fetch(async () => { throw new Error(TOKEN) })
    for (const spy of spies) expect(JSON.stringify(spy.mock.calls)).not.toContain(TOKEN)
    vi.restoreAllMocks()
  })
})

describe('Freebuff credential reader', () => {
  it('targets the same Credential Manager entry as the CLI', () => {
    expect(credentialTarget('C:\\Users\\Ricky')).toBe('freebuff-cli/C:\\Users\\Ricky\\.config\\manicode\\credentials.json')
  })

  it('decodes UTF-8 and UTF-16 blobs and trims them', () => {
    expect(decodeToken(Buffer.from(`  ${TOKEN}\n`, 'utf8'))).toBe(TOKEN)
    expect(decodeToken(Buffer.from(TOKEN, 'utf16le'))).toBe(TOKEN)
    expect(decodeToken(Buffer.from('  \n'))).toBeUndefined()
  })

  it('passes the target through the environment, reads the blob from stdout, and treats empty output as signed out', async () => {
    const run = vi.fn<RunPowerShell>(async () => Buffer.from(TOKEN, 'utf16le').toString('base64'))
    await expect(windowsTokenReader('C:\\Users\\Ricky', run)()).resolves.toBe(TOKEN)
    const [script, env] = run.mock.calls[0]!
    expect(env).toEqual({ FB_CREDENTIAL_TARGET: credentialTarget('C:\\Users\\Ricky') })
    expect(script).not.toContain(TOKEN)
    await expect(windowsTokenReader('C:\\Users\\Ricky', async () => '')()).resolves.toBeUndefined()
  })

  it('runs PowerShell encoded with the target in its environment, and hides why it failed', async () => {
    const exec = vi.fn<ExecFile>((_file, _args, _options, callback) => { callback(null, 'out') })
    await expect(runPowerShell('Write-Output 1', { FB_CREDENTIAL_TARGET: 't' }, exec)).resolves.toBe('out')
    const [file, args, options] = exec.mock.calls[0]!
    expect(file).toBe('powershell.exe')
    expect(args).toEqual(['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from('Write-Output 1', 'utf16le').toString('base64')])
    expect(options.env).toMatchObject({ FB_CREDENTIAL_TARGET: 't' })
    const failing: ExecFile = (_file, _args, _options, callback) => { callback(new Error(`secret ${TOKEN}`), '') }
    await expect(runPowerShell('x', {}, failing)).rejects.toThrow('Could not read the Freebuff sign-in from Credential Manager')
  })

  it('reads nothing and says why off Windows', async () => {
    const options = defaultQuotaOptions('linux')
    await expect(options.readToken()).resolves.toBeUndefined()
    expect(await createFreebuffQuotaSource(options).fetch(fetch)).toMatchObject({ configured: false, error: 'Freebuff usage is only read on Windows for now' })
    expect(defaultQuotaOptions('win32').unconfigured).toBeUndefined()
  })

  it.skipIf(process.platform !== 'win32')('fails closed through the real PowerShell path when the credential target is absent', async () => {
    const temp = process.env.TEMP
    process.env.TEMP = process.env.TMP = process.env.LOCALAPPDATA === undefined ? tmpdir() : join(process.env.LOCALAPPDATA, 'Temp')
    try {
      await expect(windowsTokenReader(`C:\\no-such-home-${process.pid}`)()).resolves.toBeUndefined()
    } finally {
      process.env.TEMP = process.env.TMP = temp
    }
  }, 30_000)
})

describe('Freebuff quota registration', () => {
  it('registers with the real quota controller once it exists and serves the freebuff id', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json(session()))
    const h = await harness({ quota: { readToken: async () => TOKEN, now: () => NOW, timeZone: () => 'UTC' } })
    const controller = new QuotaController(h.ctx, { fetch: fetchImpl })
    await vi.waitFor(async () => { expect(await controller.listProviders()).toContainEqual({ id: 'freebuff', name: 'Freebuff' }) })
    await expect(controller.fetch('freebuff')).resolves.toMatchObject({ providerId: 'freebuff', configured: true, ok: true })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('registers nothing when no quota wiring is supplied', async () => {
    const h = await harness()
    const controller = new QuotaController(h.ctx, { fetch: vi.fn<typeof fetch>() })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect((await controller.listProviders()).some(entry => entry.id === 'freebuff')).toBe(false)
  })
})

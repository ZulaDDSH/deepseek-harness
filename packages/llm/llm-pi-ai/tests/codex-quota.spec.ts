import { describe, expect, it, vi } from 'vitest'
import { createCodexQuotaSource } from '../src/codex-quota.ts'
import { memoryAuth } from './auth-double.ts'

const token = `header.${Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'account-test' } })).toString('base64url')}.signature`
const auth = () => memoryAuth({ 'openai-codex': { type: 'oauth', access: token, refresh: 'refresh-test', expires: Date.now() + 3_600_000 } })

describe('Codex account usage', () => {
  it('uses the inference account and the reported window durations, including reversed windows', async () => {
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      expect(url).toBe('https://chatgpt.com/backend-api/wham/usage')
      expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${token}`)
      expect(new Headers(init?.headers).get('ChatGPT-Account-Id')).toBe('account-test')
      return Response.json({ rate_limit: {
        primary_window: { used_percent: 71, limit_window_seconds: 604800, reset_at: 1_800_000_000 },
        secondary_window: { used_percent: 12, limit_window_seconds: 18000 },
      } })
    })
    await expect(createCodexQuotaSource(auth(), () => true).fetch(fetcher)).resolves.toMatchObject({ ok: true, windows: {
      weekly: { usedPercent: 71, resetAt: 1_800_000_000_000 }, '5h': { usedPercent: 12, resetAt: null },
    } })
  })
  it('does not fetch an absent or disabled account', async () => {
    const fetcher = vi.fn<typeof fetch>()
    for (const source of [createCodexQuotaSource(memoryAuth(), () => true), createCodexQuotaSource(auth(), () => false)]) {
      await expect(source.fetch(fetcher)).resolves.toMatchObject({ configured: false, ok: false })
    }
    expect(fetcher).not.toHaveBeenCalled()
  })
  it.each([{}, { rate_limit: { primary_window: { used_percent: 12, limit_window_seconds: 60 } } }])('reports unavailable data without fabricating zero usage', async (payload) => {
    const source = createCodexQuotaSource(auth(), () => true)
    await expect(source.fetch(async () => Response.json(payload))).resolves.toMatchObject({ ok: false })
  })
  it('keeps provider failures explicit', async () => {
    await expect(createCodexQuotaSource(auth(), () => true).fetch(async () => new Response('', { status: 401 }))).resolves.toMatchObject({ ok: false, error: 'Codex usage API returned HTTP 401' })
  })
  it('redacts refresh failures before returning them to the client', async () => {
    const expired = auth()
    expired.stored.set('openai-codex', { type: 'oauth', access: token, refresh: 'secret-refresh-token', expires: 0 })
    expired.credentials.modify = async () => { throw new Error('secret-refresh-token') }
    const fetcher = vi.fn<typeof fetch>()
    const result = await createCodexQuotaSource(expired, () => true).fetch(fetcher)
    expect(result).toMatchObject({ ok: false, error: 'Codex authentication failed; sign in again' })
    expect(JSON.stringify(result)).not.toContain('secret-refresh-token')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('keeps missing windows and rate-limit status explicit', async () => {
    const source = createCodexQuotaSource(auth(), () => true)
    await expect(source.fetch(async () => Response.json({ rate_limit: { primary_window: null } })))
      .resolves.toMatchObject({ ok: false, error: 'Codex usage windows unavailable' })
    await expect(source.fetch(async () => Response.json({ rate_limit: { allowed: false,
      primary_window: { used_percent: 100, limit_window_seconds: 18000, reset_at: null } } })))
      .resolves.toMatchObject({ ok: true, windows: { '5h': { usedPercent: 100, status: 'rate-limited' } } })
  })
  it('handles malformed account tokens and logout during a read', async () => {
    const invalid = auth()
    invalid.stored.set('openai-codex', { type: 'oauth', access: 'invalid-token', refresh: 'test', expires: Date.now() + 3_600_000 })
    const fetcher = vi.fn<typeof fetch>()
    await expect(createCodexQuotaSource(invalid, () => true).fetch(fetcher)).resolves.toMatchObject({ ok: false, error: 'Codex account token is invalid' })
    const loggedOut = auth()
    let reads = 0
    const read = loggedOut.credentials.read
    loggedOut.credentials.read = id => ++reads === 1 ? read(id) : Promise.resolve(undefined)
    await expect(createCodexQuotaSource(loggedOut, () => true).fetch(fetcher)).resolves.toMatchObject({ ok: false, error: 'Codex authentication unavailable' })
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('normalizes foreign fetch rejection values', async () => {
    await expect(createCodexQuotaSource(auth(), () => true).fetch(async () => { throw 'offline' }))
      .resolves.toMatchObject({ ok: false, error: 'Codex usage request failed' })
  })

})

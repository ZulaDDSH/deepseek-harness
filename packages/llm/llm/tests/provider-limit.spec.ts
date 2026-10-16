import { describe, expect, it } from 'vitest'
import { providerUsageLimitOf } from '../src/provider-limit.ts'

const body = (message: string): string => `400 ${JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message } })}`

describe('providerUsageLimitOf', () => {
  it('reads the date and instant an Anthropic API usage limit lifts', () => {
    expect(providerUsageLimitOf(body('You have reached your specified API usage limits. You will regain access on 2026-11-01 at 00:00 UTC.')))
      .toEqual({ regainDate: '2026-11-01 at 00:00 UTC', regainAt: Date.UTC(2026, 10, 1) })
    expect(providerUsageLimitOf(body('You have reached your specified API usage limits. You will regain access on 2026-11-01 at 13:30 UTC.')))
      .toMatchObject({ regainAt: Date.UTC(2026, 10, 1, 13, 30) })
    expect(providerUsageLimitOf(body('You have reached your specified API usage limits. You will regain access on 2026-11-01.')))
      .toEqual({ regainDate: '2026-11-01', regainAt: Date.UTC(2026, 10, 1) })
  })

  it('keeps a date it cannot read as text only', () => {
    expect(providerUsageLimitOf(body('You have reached your specified API usage limits. You will regain access on the first of November.')))
      .toEqual({ regainDate: 'the first of November' })
  })

  it('recognizes a limit that names no date', () => {
    expect(providerUsageLimitOf(body('You have reached your specified API usage limits.'))).toEqual({})
  })

  it('ignores other failures', () => {
    expect(providerUsageLimitOf(body('messages: field required'))).toBeUndefined()
    expect(providerUsageLimitOf('You have reached your specified API usage limits.')).toBeUndefined()
    expect(providerUsageLimitOf('429 rate_limit_error: slow down')).toBeUndefined()
  })
})

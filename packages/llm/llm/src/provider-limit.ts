/** Provider spend-limit detection for terminal request failures. */

/** A provider refusal because its spending or usage limit was reached. */
export interface ProviderUsageLimit {
  /** When access returns, as the provider wrote it, if the message names a date. */
  readonly regainDate?: string
  /** The same instant in Unix epoch milliseconds, when the provider wrote a UTC date this reader understands. */
  readonly regainAt?: number
}

const REGAIN_INSTANT = /^(\d{4}-\d{2}-\d{2})(?:\s+at\s+(\d{2}:\d{2}))?(?:\s+UTC)?$/i

/**
 * Recognize an Anthropic `invalid_request_error` that reports the API usage limit.
 * @param message - Raw failure message, usually the provider's HTTP status and JSON body.
 * @returns the limit and its regain date, or undefined for any other failure.
 */
export function providerUsageLimitOf(message: string): ProviderUsageLimit | undefined {
  if (!message.includes('invalid_request_error') || !/API usage limits/i.test(message)) return undefined
  const regainDate = /regain access on ([^."\\]+)/i.exec(message)?.[1]?.trim()
  if (regainDate === undefined || regainDate === '') return {}
  const parts = REGAIN_INSTANT.exec(regainDate)
  const regainAt = parts === null ? Number.NaN : Date.parse(`${parts[1]}T${parts[2] ?? '00:00'}:00Z`)
  return Number.isFinite(regainAt) ? { regainDate, regainAt } : { regainDate }
}

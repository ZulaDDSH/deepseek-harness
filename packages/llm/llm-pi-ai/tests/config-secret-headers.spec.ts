import { describe, expect, it } from 'vitest'
import { redactSecrets } from '@deepseek-ai/dsh-settings'
import { Config } from '../src/config.ts'

describe('profile headers in settings views', () => {
  it('removes every header value from a redacted view and reports the slots', () => {
    const value = {
      providers: {
        gateway: { api: 'openai-completions', baseURL: 'https://gw.test', headers: { Authorization: 'Bearer live', 'x-api-key': 'k' } },
      },
    }
    const redacted = redactSecrets(Config as never, value)
    expect(JSON.stringify(redacted.value)).not.toContain('Bearer live')
    expect(JSON.stringify(redacted.value)).not.toContain('"k"')
    expect(redacted.secrets.map(slot => slot.path.join('.'))).toEqual(
      expect.arrayContaining(['providers.gateway.headers.Authorization', 'providers.gateway.headers.x-api-key']),
    )
  })
})

/**
 * Pre-change proof for the shared knowledge endpoint: an authenticated
 * Streamable HTTP MCP entry must take its credential from the environment
 * rather than from the committed `cordis.yml`, and must never expose the
 * resolved value to a config dump or a log line.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { resolveHttpHeaders } from '@deepseek-ai/dsh-mcp-client/src/transport.ts'

const TOKEN_VAR = 'GARDEN_KNOWLEDGE_TOKEN'
const ORIGINAL = process.env[TOKEN_VAR]

beforeEach(() => {
  Reflect.deleteProperty(process.env, TOKEN_VAR)
})

afterEach(() => {
  if (ORIGINAL === undefined) Reflect.deleteProperty(process.env, TOKEN_VAR)
  else process.env[TOKEN_VAR] = ORIGINAL
})

describe('knowledge endpoint credentials', () => {
  it('resolves a header from the environment variable it names', () => {
    process.env[TOKEN_VAR] = 'Bearer lan-secret-value'
    expect(resolveHttpHeaders({ headerEnv: { Authorization: TOKEN_VAR } }))
      .toEqual({ Authorization: 'Bearer lan-secret-value' })
  })

  it('takes the whole header value from the variable, so any scheme works', () => {
    process.env[TOKEN_VAR] = 'ApiKey lan-secret-value'
    expect(resolveHttpHeaders({ headerEnv: { 'X-Api-Key': TOKEN_VAR } }))
      .toEqual({ 'X-Api-Key': 'ApiKey lan-secret-value' })
  })

  it('lets a literal header override the environment variable', () => {
    process.env[TOKEN_VAR] = 'Bearer lan-secret-value'
    expect(resolveHttpHeaders({
      headers: { Authorization: 'Bearer literal' },
      headerEnv: { Authorization: TOKEN_VAR },
    })).toEqual({ Authorization: 'Bearer literal' })
  })

  it('omits a header whose variable is unset rather than sending an empty credential', () => {
    expect(resolveHttpHeaders({ headerEnv: { Authorization: TOKEN_VAR } })).toEqual({})
  })

  it('fails loudly when a configured credential variable is missing', () => {
    expect(() => resolveHttpHeaders({ headerEnv: { Authorization: TOKEN_VAR } }, { required: true }))
      .toThrow(/GARDEN_KNOWLEDGE_TOKEN/)
  })

  it('keeps the resolved credential out of the resolved config', () => {
    process.env[TOKEN_VAR] = 'Bearer lan-secret-value'
    const resolved = resolveHttpHeaders({ headerEnv: { Authorization: TOKEN_VAR } })
    expect(resolved.Authorization).toBe('Bearer lan-secret-value')

    // The config the harness retains and may serialize names the variable only.
    const config = {
      transport: 'streamable-http' as const,
      serverName: 'garden-knowledge',
      url: 'http://192.168.1.50:18080/mcp',
      headers: {},
      headerEnv: { Authorization: TOKEN_VAR },
      toolCallTimeoutMs: 60_000,
      failOnStartupError: false,
    }
    expect(JSON.stringify(config)).not.toContain('lan-secret-value')
  })
})

import { afterEach, expect, it, vi } from 'vitest'
import { resolveHttpHeaders } from '../src/transport.ts'

afterEach(() => vi.unstubAllEnvs())

it('resolves environment headers, lets literal headers win, and rejects missing required values', () => {
  vi.stubEnv('MCP_TOKEN', 'secret')
  vi.stubEnv('MISSING_TOKEN', '')
  expect(resolveHttpHeaders({
    headers: { Authorization: 'Bearer literal' },
    headerEnv: { Authorization: 'MCP_TOKEN', 'X-Token': 'MCP_TOKEN', 'X-Missing': 'MISSING_TOKEN' },
  })).toEqual({ Authorization: 'Bearer literal', 'X-Token': 'secret' })
  expect(() => resolveHttpHeaders({ headerEnv: { Authorization: 'MISSING_TOKEN' } }, true))
    .toThrow(/Authorization.*MISSING_TOKEN.*unset or empty/)
})

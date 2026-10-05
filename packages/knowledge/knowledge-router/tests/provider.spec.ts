/**
 * Provider probing and configuration resolution: liveness is read from the
 * registry, never rebuilt from the client's naming rule.
 */

import { describe, expect, it } from 'vitest'
import { KnowledgeRouter, resolveConfig } from '../src/index.ts'
import { providerStatus, providerStatuses, registeredToolName, serverToolNames } from '../src/provider.ts'

const schemas = [
  { name: 'mcp__gitnexus__query' },
  { name: 'mcp__gitnexus__impact' },
  { name: 'mcp__graphify__query_graph' },
  { name: 'fs_read' },
]

describe('serverToolNames', () => {
  it('lists only the named server raw tool names, sorted', () => {
    expect(serverToolNames(schemas, 'gitnexus')).toEqual(['impact', 'query'])
    expect(serverToolNames(schemas, 'graphify')).toEqual(['query_graph'])
  })

  it('reports no tools for an unregistered server', () => {
    expect(serverToolNames(schemas, 'absent')).toEqual([])
  })
})

describe('registeredToolName', () => {
  it('resolves the name the registry actually holds', () => {
    expect(registeredToolName(schemas, 'gitnexus', 'query')).toBe('mcp__gitnexus__query')
  })

  it('returns undefined when the server does not expose that raw name', () => {
    expect(registeredToolName(schemas, 'gitnexus', 'rename')).toBeUndefined()
    expect(registeredToolName(schemas, 'absent', 'query')).toBeUndefined()
  })
})

describe('providerStatus', () => {
  it('reports a disabled provider with no tools', () => {
    expect(providerStatus('gitnexus', undefined, schemas)).toMatchObject({
      enabled: false,
      connected: false,
      serverName: '',
      tools: [],
    })
  })

  it('reports an enabled but unregistered provider as disconnected', () => {
    expect(providerStatus('gitnexus', 'absent', schemas)).toMatchObject({ enabled: true, connected: false })
  })

  it('reports a registered provider as connected', () => {
    expect(providerStatus('graphify', 'graphify', schemas)).toMatchObject({ enabled: true, connected: true })
  })
})

describe('providerStatuses', () => {
  it('reports every supported provider in a stable order', () => {
    expect(providerStatuses({ gitnexus: 'gitnexus' }, schemas).map(status => status.provider))
      .toEqual(['gitnexus', 'graphify'])
  })
})

describe('resolveConfig', () => {
  it('defaults to off with no providers enabled', () => {
    const resolved = resolveConfig({})
    expect(resolved.mode).toBe('off')
    expect(resolved.providers).toEqual({})
  })

  it('defaults a server name to the provider name and keeps per-provider bounds', () => {
    const resolved = resolveConfig({ mode: 'assisted', gitnexus: { enabled: true }, graphify: { enabled: true, serverName: 'gfy', tokenBudget: 42 } })
    expect(resolved.providers).toEqual({ gitnexus: 'gitnexus', graphify: 'gfy' })
    expect(resolved.graphifyTokenBudget).toBe(42)
    expect(resolved.mode).toBe('assisted')
  })

  it('ignores a provider block that is present but not enabled', () => {
    expect(resolveConfig({ gitnexus: { serverName: 'gn' } }).providers).toEqual({})
  })

  it('is the schema used by the service class', () => {
    expect(KnowledgeRouter.Config).toBeDefined()
  })
})

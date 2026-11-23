import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AuthorizationService from '@deepseek-ai/dsh-authorization'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { describe, expect, it } from 'vitest'
import * as freebuff from '../src/index.ts'
import { FREEBUFF_KEY } from '../src/index.ts'
import { scratch } from './harness.ts'

describe('Freebuff plugin entry', () => {
  it('mounts with its real wiring and registers the route, the settings row and the sign-in flow', async () => {
    const ctx = new Context()
    ctx.provide('sessions', { get: () => undefined } as never)
    ctx.provide('workingDirectory', { get: () => process.cwd() } as never)
    await ctx.plugin(LocalCredentialProvider, { path: join(scratch(), '.credentials.yaml'), watch: false })
    await ctx.plugin(AuthorizationService)
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(freebuff)
    expect(ctx.llm.listProviders().map(provider => provider.id)).toContain('freebuff')
    expect(ctx.llm.listConfigurableProviders().find(entry => entry.provider === 'freebuff')?.settingsNs).toBeTruthy()
    expect(ctx.authorization.describe(FREEBUFF_KEY)?.label).toBe('Freebuff')
    await ctx.fiber.dispose()
  })

  it('declares a volatile idle reap field with a ten minute default', () => {
    const parsed = freebuff.Config({})
    expect(parsed.idleReapMs?.get()).toBe(freebuff.DEFAULT_IDLE_REAP_MS)
    expect(freebuff.DEFAULT_IDLE_REAP_MS).toBe(600_000)
    expect(freebuff.name).toBe('llm-freebuff')
  })
})

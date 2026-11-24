import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AuthorizationService from '@deepseek-ai/dsh-authorization'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import LlmRuntime, { LlmError } from '@deepseek-ai/dsh-llm'
import { SubprocessExecutableNotFoundError } from '@deepseek-ai/dsh-subprocess'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { describe, expect, it, vi } from 'vitest'
import * as freebuff from '../src/index.ts'
import { FREEBUFF_KEY } from '../src/auth.ts'
import { defaultEnvironment } from '../src/environment.ts'
import { DEFAULT_IDLE_REAP_MS } from '../src/install.ts'
import { harness, scratch } from './harness.ts'

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
    expect(parsed.idleReapMs?.get()).toBe(DEFAULT_IDLE_REAP_MS)
    expect(DEFAULT_IDLE_REAP_MS).toBe(600_000)
    expect(freebuff.name).toBe('llm-freebuff')
  })
})

describe('Freebuff installation', () => {
  it('turns off settings auto-configuration for its fiber and reads the reap delay from its config', async () => {
    const h = await harness({ idleReapMs: 1_234 })
    expect(h.settingsCalls).toHaveLength(1)
    expect(h.settingsCalls[0]![0]).toEqual({ auto: false })
    expect(h.pool().options.idleReapMs()).toBe(1_234)
  })

  it('falls back to the default reap delay without a config value', async () => {
    const h = await harness({ emptyConfig: true })
    expect(h.pool().options.idleReapMs()).toBe(DEFAULT_IDLE_REAP_MS)
  })

  it('does not let a failing pool shutdown escape when the plugin is disposed', async () => {
    const h = await harness()
    const dispose = vi.spyOn(h.pool(), 'dispose').mockRejectedValue(new Error('stuck'))
    await h.ctx.fiber.dispose()
    expect(dispose).toHaveBeenCalledOnce()
  })
})

describe('Freebuff default environment', () => {
  const environmentWith = (resolveExecutable: () => Promise<string>) => defaultEnvironment({ subprocess: { resolveExecutable } } as never)

  it('resolves the freebuff executable through the subprocess runtime', async () => {
    await expect(environmentWith(async () => '/bin/freebuff').resolveExecutable(new AbortController().signal)).resolves.toBe('/bin/freebuff')
  })

  it('explains a missing executable and passes other failures through', async () => {
    const missing = environmentWith(async () => { throw new SubprocessExecutableNotFoundError('nope') })
    await expect(missing.resolveExecutable(new AbortController().signal)).rejects.toBeInstanceOf(LlmError)
    await expect(missing.resolveExecutable(new AbortController().signal)).rejects.toMatchObject({ failure: { code: 'INVALID_CONFIG' } })
    const broken = environmentWith(async () => { throw new Error('boom') })
    await expect(broken.resolveExecutable(new AbortController().signal)).rejects.toThrow('boom')
  })
})

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import SessionStore, { type SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { runOptionsProjection } from '../src/run-options.ts'
import { teamRoleDefaultOf } from '../src/team-role-defaults.ts'

const contexts = new Set<Context>()
afterEach(async () => {
  await Promise.all([...contexts].map(ctx => ctx.fiber.dispose()))
  contexts.clear()
})

async function fixture() {
  const ctx = new Context()
  contexts.add(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.sessionProjections.register(runOptionsProjection)
  return ctx
}

const route = { backend: 'llm', provider: 'alpha', model: 'coder-model', reasoningEffort: 'high' } as const
const setup = {
  enabled: true,
  reviewRounds: 2,
  roles: { coder: { mode: 'fixed', route } },
  gsd: { enabled: true, gates: 'auto', planAuthor: 'researcher', planning: 'local', checkRounds: 1, parallelWaves: true },
  autoResponder: { enabled: true },
}

describe('saved Team role defaults', () => {
  it('reads a historical route and uses the nearest ancestor or global default', async () => {
    const ctx = await fixture()
    const root = ctx.sessions.create(brandString<SessionId>('role-default-root'))
    root.append('session/run-options', { subagentSetup: setup })
    const child = ctx.sessions.create(brandString<SessionId>('role-default-child'), {
      meta: { parentSession: root.id },
    })
    const global = ctx.sessions.create(brandString<SessionId>('role-default-global'))
    const globalRoute = { backend: 'llm', provider: 'beta', model: 'global-model' } as const

    expect(teamRoleDefaultOf(ctx, child, 'coder', undefined)).toEqual(route)
    expect(teamRoleDefaultOf(ctx, global, 'reviewer', {
      enabled: true, reviewRounds: 2, roles: { reviewer: { mode: 'fixed', route: globalRoute } },
    })).toEqual(globalRoute)
    expect(ctx.sessionProjections.snapshot(root, ['runOptions']).values.runOptions?.current)
      .toEqual({ subagentSetup: setup })
  })

  it('lets an explicit disabled child suppress inherited defaults and fails on a missing ancestor', async () => {
    const ctx = await fixture()
    const root = ctx.sessions.create(brandString<SessionId>('role-disabled-root'))
    root.append('session/run-options', { subagentSetup: setup })
    const child = ctx.sessions.create(brandString<SessionId>('role-disabled-child'), {
      meta: { parentSession: root.id },
    })
    child.append('session/run-options', { subagentSetup: { enabled: false, reviewRounds: 2, roles: {} } })
    const detached = ctx.sessions.create(brandString<SessionId>('role-missing-parent'), {
      meta: { parentSession: brandString<SessionId>('not-loaded') },
    })

    expect(teamRoleDefaultOf(ctx, child, 'coder', setup)).toBeUndefined()
    expect(() => teamRoleDefaultOf(ctx, detached, 'coder', setup)).toThrow('restore the Team root and retry')
  })
})

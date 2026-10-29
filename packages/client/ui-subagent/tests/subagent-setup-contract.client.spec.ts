import { describe, expect, it } from 'vitest'
import * as host from '../../../api/session-controller/src/subagent-setup.ts'
import { SESSION_RUN_OPTION_EFFORTS as hostEfforts } from '../../../api/session-controller/src/types.ts'
import * as copy from '../src/client/subagent-setup/contract.ts'

describe('browser Subagent Setup contract copy', () => {
  it('matches the Host source', () => {
    expect(copy.SUBAGENT_SETUP_ROLES).toEqual(host.SUBAGENT_SETUP_ROLES)
    expect(copy.SUBAGENT_REVIEW_ROUNDS_MAX).toBe(host.SUBAGENT_REVIEW_ROUNDS_MAX)
    expect(copy.SESSION_RUN_OPTION_EFFORTS).toEqual(hostEfforts)
    expect(copy.GSD_GATES).toEqual(host.GSD_GATES)
    expect(copy.GSD_PLAN_AUTHORS).toEqual(host.GSD_PLAN_AUTHORS)
    expect(copy.GSD_PLANNING_MODES).toEqual(host.GSD_PLANNING_MODES)
    expect(copy.GSD_CHECK_ROUNDS_MAX).toBe(host.GSD_CHECK_ROUNDS_MAX)
    for (const setup of [
      { enabled: false, reviewRounds: 2, roles: {} },
      { enabled: true, reviewRounds: 0, roles: {} },
      { enabled: true, reviewRounds: 1, roles: { coder: { mode: 'jev' } } },
      { enabled: true, reviewRounds: 3, roles: { coder: { mode: 'jev' }, reviewer: { mode: 'jev' }, researcher: { mode: 'jev' } } },
    ] as const) {
      expect(copy.subagentPolicyPrompt(setup)).toBe(host.subagentPolicyText(setup))
    }
  })

  it('pins the GSD defaults to the strict schema defaults and the workflow text to the Host', () => {
    const parsed = host.subagentSetupSchema.parse({ enabled: true, reviewRounds: 0, roles: {}, gsd: { enabled: true } })
    expect(parsed.gsd).toEqual({ enabled: true, ...copy.GSD_DEFAULTS })
    const gsdVariants = [
      { ...copy.GSD_DEFAULTS, enabled: true },
      { enabled: true, gates: 'auto', planAuthor: 'researcher', planning: 'local', checkRounds: 0, parallelWaves: false },
      { enabled: true, gates: 'plan-and-ship', planAuthor: 'orchestrator', planning: 'commit', checkRounds: 1, parallelWaves: true },
      { enabled: false, ...copy.GSD_DEFAULTS },
    ] as const
    for (const gsd of gsdVariants) {
      for (const enabled of [true, false]) {
        const setup = { enabled, reviewRounds: 2, roles: { coder: { mode: 'jev' } } as const, gsd }
        expect(copy.subagentWorkflowPrompt(setup)).toBe(host.subagentWorkflowText(setup))
      }
    }
    expect(copy.subagentWorkflowPrompt({ enabled: true, reviewRounds: 2, roles: {} })).toBe('')
  })

  it('accepts the auto responder switch in the strict Host schema', () => {
    const setup = { enabled: false, reviewRounds: 0, roles: {}, autoResponder: { enabled: true } }
    expect(host.subagentSetupSchema.parse(setup)).toEqual(setup)
    expect(host.subagentSetupSchema.safeParse({ ...setup, autoResponder: { enabled: true, extra: 1 } }).success).toBe(false)
  })
})

import type { ModelSelection } from '@deepseek-ai/dsh-api-session-controller/types'

/** The part of an Orchestrator & Subagent Setup that locks the model picker. */
export interface LockingSetup {
  readonly enabled: boolean
  readonly roles: { readonly orchestrator?: LockingRole | undefined }
}

interface LockingRole {
  readonly mode: string
  readonly route?: LockingRoute | undefined
}

interface LockingRoute {
  readonly backend?: string
  readonly provider?: unknown
  readonly model?: unknown
  readonly reasoningEffort?: unknown
}

/** Whether the setup locks the picker, whether a fixed orchestrator locks the effort, and the route the Session runs on. */
export interface SubagentLock {
  readonly on: boolean
  readonly effortLocked: boolean
  readonly route: ModelSelection | undefined
}

function lockingSetupOf(value: unknown): LockingSetup | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as { enabled?: unknown; roles?: unknown }
  return typeof candidate.enabled === 'boolean' && typeof candidate.roles === 'object' && candidate.roles !== null
    ? candidate as LockingSetup
    : undefined
}

function orchestratorRouteOf(setup: LockingSetup): ModelSelection | undefined {
  const orchestrator = setup.roles.orchestrator
  const route = orchestrator?.mode === 'fixed' ? orchestrator.route : undefined
  if (route?.backend !== 'llm' || typeof route.provider !== 'string' || typeof route.model !== 'string') return undefined
  const { reasoningEffort } = route
  return {
    provider: route.provider,
    model: route.model,
    ...typeof reasoningEffort === 'string' ? { reasoningEffort } : {},
  }
}

/**
 * Resolve the lock a Session's effective setup puts on the picker: its own override, else the global default.
 * @param override - the setup in the Session's run-options projection, when it has one.
 * @param globalDefault - the raw global default read from the settings section; a malformed value is ignored as the Host ignores it.
 * @returns whether subagent mode is on, whether a fixed orchestrator route also locks the effort, and the route the Session runs on.
 */
export function subagentLockOf(override: LockingSetup | undefined, globalDefault: unknown): SubagentLock {
  const setup = override ?? lockingSetupOf(globalDefault)
  if (setup?.enabled !== true) return { on: false, effortLocked: false, route: undefined }
  const route = orchestratorRouteOf(setup)
  return { on: true, effortLocked: route !== undefined, route }
}

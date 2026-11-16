import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import type { SubagentTeamRole, SubagentTeamRoleRoute } from './subagent-setup.ts'
import { subagentTeamRoleRouteOf } from './subagent-setup.ts'

export function teamRoleDefaultOf(
  ctx: Context,
  session: Session,
  role: SubagentTeamRole,
  globalDefault: unknown,
): SubagentTeamRoleRoute | undefined {
  let current: Session | undefined = session
  for (let hop = 0; current !== undefined && hop < 8; hop += 1) {
    const setup = ctx.sessionProjections.snapshot(current, ['runOptions']).values.runOptions?.current?.subagentSetup
    if (setup !== undefined) return subagentTeamRoleRouteOf(setup, role)
    const parentId = current.header.parentSession
    if (parentId === undefined) return subagentTeamRoleRouteOf(globalDefault, role)
    current = ctx.sessions.get(parentId)
    if (current === undefined) {
      throw new Error(`cannot resolve saved Team role defaults for ${role}: ancestor Session "${parentId}" is not loaded; restore the Team root and retry`)
    }
  }
  if (current !== undefined) {
    throw new Error(`cannot resolve saved Team role defaults for ${role}: ancestor chain exceeds eight Sessions`)
  }
  return undefined
}

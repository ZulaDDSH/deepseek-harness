/** Per-Session run options: the durable projection for every Session, and the Ultracode instruction that reads it. */

import type { Context } from '@deepseek-ai/cordis'
import type { AssembleContext } from '@deepseek-ai/dsh-system-prompt'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { ultracodeSupported } from '@deepseek-ai/dsh-llm'
import { z } from 'zod'
import { SESSION_RUN_OPTION_EFFORTS, type ModelSelection, type SessionRunOptions, type SessionRunOptionsProjection } from './types.ts'
import { subagentPolicyText, subagentSetupSchema, subagentWorkflowText } from './subagent-setup.ts'
import { effectiveSubagentSetupOf, orchestratorSelectionOf } from './setup-resolver.ts'

export { effectiveSubagentSetupOf } from './setup-resolver.ts'

const ULTRACODE_INSTRUCTION = 'Ultracode is on for this session: the user has asked you to run substantive work as multi-agent workflows. When plan mode is not active and the task is more than a quick answer or one small edit, plan the work first, split it into independent pieces, and run those pieces through your delegation tools, such as the subagent tool and the workflow tool when they are listed. Give each subagent a self-contained brief with its files, constraints, and expected answer. Before you report a result, have a separate subagent try to refute it against the original request and the evidence, and fix what it finds. If no delegation tool is listed, do the planning and the adversarial check yourself.'

const runOptionsSchema: z.ZodType<SessionRunOptions> = z.object({
  fastMode: z.boolean().optional(),
  ultracode: z.boolean().optional(),
  effort: z.enum(SESSION_RUN_OPTION_EFFORTS).optional(),
  subagentSetup: subagentSetupSchema.optional(),
})
const stateSchema: z.ZodType<SessionRunOptionsProjection> = z.object({ current: runOptionsSchema.nullable() })

/**
 * Validate and normalize one run-options write, keeping only the fields it sets.
 * @param request - the complete run options the caller writes.
 * @returns the validated options; throws a gateway bad-request error when a field is invalid.
 */
export function runOptionsValue(request: SessionRunOptions): SessionRunOptions {
  const { fastMode, ultracode, effort, subagentSetup } = request
  if ((fastMode !== undefined && typeof fastMode !== 'boolean') || (ultracode !== undefined && typeof ultracode !== 'boolean')) {
    throw new RemoteError('gateway/bad-request', 'fastMode and ultracode must be booleans', {})
  }
  if (effort !== undefined && !SESSION_RUN_OPTION_EFFORTS.includes(effort)) {
    throw new RemoteError('gateway/bad-request', `effort must be one of ${SESSION_RUN_OPTION_EFFORTS.join(', ')}`, {})
  }
  const setup = subagentSetup === undefined ? undefined : subagentSetupSchema.safeParse(subagentSetup)
  if (setup !== undefined && !setup.success) {
    throw new RemoteError('gateway/bad-request', `subagentSetup is invalid: ${z.prettifyError(setup.error)}`, {})
  }
  return {
    ...fastMode === undefined ? {} : { fastMode },
    ...ultracode === undefined ? {} : { ultracode },
    ...effort === undefined ? {} : { effort },
    ...setup === undefined ? {} : { subagentSetup: setup.data },
  }
}

/**
 * The model a Session's next request uses: its chosen selection, else its last request's, else the Agent default.
 * @param ctx - Host context carrying the model-selection projection and the Agent default.
 * @param session - the Session to resolve.
 * @returns the provider and model id of that request.
 */
export function sessionModelOf(ctx: Context, session: Session): ModelSelection {
  const next = ctx.sessionProjections.snapshot(session, ['modelSelection']).values.modelSelection?.next
  return orchestratorSelectionOf(ctx, session) ?? next ?? ctx.agentDefaultModel.currentSelection()
}

/**
 * Whether a Session's Ultracode flag takes effect: it is stored on and the Session's model supports Ultracode.
 * @param ctx - Host context carrying the run-options and model-selection projections.
 * @param session - the Session to test.
 * @returns true when the Ultracode instruction and native Ultracode apply to the Session.
 */
export function ultracodeActive(ctx: Context, session: Session): boolean {
  return ctx.sessionProjections.snapshot(session, ['runOptions']).values.runOptions?.current?.ultracode === true
    && ultracodeSupported(sessionModelOf(ctx, session).model)
}

const runOptionsProjection = {
  key: 'runOptions',
  stateSchema,
  init: () => ({ current: null }),
  apply: (state, event: SessionEvent) => event.type === 'session/run-options'
    ? { current: { ...event.data } }
    : state,
  wire: { viewSchema: stateSchema, view: state => ({ current: state.current }) },
  stateVersion: 1,
} satisfies ProjectionDefinition<'runOptions', SessionRunOptionsProjection>

/**
 * Register the per-Session run options projection and the Ultracode prompt section.
 * @param ctx - Session Controller context; the section is deployment-global and reads each agent's own Session.
 */
export function installRunOptions(ctx: Context): void {
  void ctx.sessionProjections.register(runOptionsProjection)
  ctx.inject(['systemPrompt'], ({ systemPrompt }) => {
    const ultracodeOn = (context: AssembleContext): boolean => context.agent !== undefined
      && context.agent.session.header.origin !== 'subagent'
      && ultracodeActive(ctx, context.agent.session)
    systemPrompt.section({
      name: 'session:ultracode',
      order: systemPrompt.getSectionOrder('ULTRACODE_POLICY'),
      text: context => ultracodeOn(context) ? ULTRACODE_INSTRUCTION : '',
    })
    // Constraint: a complete persona keeps no section, so its prefix must reference {{ultracode_policy}}.
    systemPrompt.variable('ultracode_policy', context => ultracodeOn(context) ? `\n\n${ULTRACODE_INSTRUCTION}` : '')
    const subagentPolicyFor = (context: AssembleContext): string => {
      if (context.agent === undefined || context.agent.session.header.origin === 'subagent') return ''
      const setup = effectiveSubagentSetupOf(ctx, context.agent.session)
      if (setup === undefined || !setup.enabled || ctx.get('tools')?.get('subagent', context.scope) === undefined) return ''
      return subagentPolicyText(setup)
    }
    systemPrompt.section({
      name: 'session:subagent-policy',
      order: systemPrompt.getSectionOrder('SUBAGENT_POLICY'),
      text: subagentPolicyFor,
    })
    systemPrompt.variable('subagent_policy', (context) => {
      const text = subagentPolicyFor(context)
      return text === '' ? '' : `\n\n${text}`
    })
    const gsdWorkflowFor = (context: AssembleContext): string => {
      if (context.agent === undefined || context.agent.session.header.origin === 'subagent') return ''
      if (ctx.get('tools')?.get('subagent', context.scope) === undefined) return ''
      const setup = effectiveSubagentSetupOf(ctx, context.agent.session)
      return setup === undefined ? '' : subagentWorkflowText(setup)
    }
    systemPrompt.section({
      name: 'session:gsd-workflow',
      order: systemPrompt.getSectionOrder('GSD_WORKFLOW'),
      text: gsdWorkflowFor,
    })
    systemPrompt.variable('gsd_workflow', (context) => {
      const text = gsdWorkflowFor(context)
      return text === '' ? '' : `\n\n${text}`
    })
  })
}

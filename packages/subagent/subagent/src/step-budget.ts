import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContextFormed } from '@deepseek-ai/dsh-llm'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import { delegationDepthOf } from './depth.ts'

// Reuses the finalized format-4 reminder kind; a dedicated kind needs Session format 5.
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'repeat-tool-reminder': { kind: 'repeat-tool-reminder' } & ContextFormed
  }
}

/**
 * Text a child receives when one turn reaches its step budget.
 * @param steps - the configured budget.
 * @returns the nudge text.
 */
export function stepBudgetText(steps: number): string {
  return `You have taken ${steps} steps on this task, and every step resends your whole history. `
    + 'Wrap up now: finish only what is nearly done, then reply with what is finished, what is left, '
    + 'and anything you could not check. Your parent can start a fresh subagent for the rest.'
}

/**
 * Append the wrap-up nudge when a delegated child's turn reaches the budget step.
 * @param decision - the downstream pre-step decision.
 * @param step - the proposed step within the turn.
 * @param steps - current step budget; 0 turns the nudge off.
 * @param depth - the agent's delegation depth; 0 is a top-level agent.
 * @returns the decision, with the nudge appended on the budget step.
 */
export function withStepBudget(decision: PreStepDecision, step: number, steps: number, depth: number): PreStepDecision {
  if (decision.kind === 'reject' || steps === 0 || step !== steps || depth === 0) return decision
  const text = stepBudgetText(steps)
  return {
    ...decision,
    messages: [
      ...decision.messages,
      createUserMessage({
        content: [{ type: 'text', text }],
        source: { kind: 'repeat-tool-reminder', form: 'notice', summary: `step budget ${steps}` },
      }),
    ],
  }
}

/**
 * Nudge delegated children to report once a turn reaches the step budget.
 * @param ctx - context whose agents are observed.
 * @param budget - current step budget; 0 turns the nudge off.
 */
export function installStepBudget(ctx: Context, budget: () => number): void {
  ctx.on('agent/pre-step', async ({ agent, step, signal }, next): Promise<PreStepDecision> => {
    const decision = await next()
    return signal.aborted ? decision : withStepBudget(decision, step, budget(), delegationDepthOf(agent))
  }, { prepend: true })
}

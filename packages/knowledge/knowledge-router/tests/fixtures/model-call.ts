import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'

/**
 * Run one model tool call as a single-call batch.
 * @param ctx - context owning the selected executor.
 * @param input - call identity, JSON-encodable arguments, cancellation, and optional calling Agent.
 * @returns the settled result of that call.
 */
export async function executeModelCall(
  ctx: Context,
  input: { callId: ToolCallId; name: string; arguments: unknown; signal: AbortSignal; agent?: Agent },
): Promise<ToolExecutionResult> {
  const batch = await ctx.tools.execute({
    calls: [{ type: 'tool-call', id: input.callId, name: input.name, arguments: JSON.stringify(input.arguments) }],
    signal: input.signal,
    ...input.agent === undefined ? {} : { agent: input.agent },
  })
  const outcome = batch.results[0]
  if (outcome === undefined) throw new Error('Executor omitted the model tool result')
  return outcome.result
}

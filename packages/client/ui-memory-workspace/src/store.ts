/** @module Provider-acknowledged writes through the connected Memorix server. */
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { McpHumanOperations } from '@deepseek-ai/dsh-mcp-client'
import { z } from 'zod'

const Outcome = z.object({
  isError: z.boolean().optional(),
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
})
const ACKNOWLEDGEMENT = new RegExp('\\[(?:OK|UPDATED)\\] (?:Stored|Updated) observation #(\\d+) [^\\n]*\\n'
  + 'Entity: [^\\n]*? \\| Project: ([^|\\n]+) \\| Topic:')

/** The observation Memorix acknowledged for one write. */
export interface StoredObservation {
  /** Numeric observation identifier. */
  id: number
  /** Project the server resolved for the write. */
  project: string
}

/**
 * Write one observation through `memorix_store` and parse the server's acknowledgement.
 * @param provider - connected Memorix operations.
 * @param args - complete `memorix_store` arguments.
 * @param signal - write lifetime.
 * @param subject - noun used in failure messages, such as `document chunk`.
 * @returns the acknowledged observation identifier and project.
 * @throws when Memorix refuses the write or returns no recognizable acknowledgement; the message carries the server's own text.
 */
export async function storeObservation(provider: McpHumanOperations, args: Record<string, JsonValue>,
  signal: AbortSignal, subject: string): Promise<StoredObservation> {
  const reply = Outcome.safeParse(await provider.call('memorix_store', args, signal))
  if (!reply.success) throw new Error(`Memorix returned an unexpected reply to memorix_store for this ${subject}`)
  const outcome = reply.data
  const text = outcome.content.filter(item => item.type === 'text').map(item => item.text ?? '').join('\n')
  const detail = text.trim() === '' ? '' : `: ${text.trim().slice(0, 300)}`
  if (outcome.isError === true) throw new Error(`Memorix rejected this ${subject}${detail}`)
  const stored = ACKNOWLEDGEMENT.exec(text)
  if (stored === null) throw new Error(`Memorix did not persist the complete ${subject}${detail}`)
  return { id: Number(stored[1]), project: String(stored[2]).trim() }
}

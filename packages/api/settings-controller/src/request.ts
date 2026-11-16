import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'

/** Constraint: shared wire validation maps schema failures to RemoteError. */
export const settingsRequest = {
  parse<T>(method: string, schema: z.ZodType<T>, value: unknown): T {
    const parsed = schema.safeParse(value)
    if (!parsed.success) {
      throw new RemoteError('gateway/bad-request', `invalid payload for ${method}`, { issues: parsed.error.issues })
    }
    return parsed.data
  },
}

/** Provider-reported usage grouped by the route that ran each request. */
import { z } from 'zod'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { tokenUsageProjectionDefinition, tokenUsageStateSchema } from './usage-projection.ts'

const routeSchema = z.object({ provider: z.string(), model: z.string() }).strict()
const modelUsageStateSchema = z.object({
  route: routeSchema.nullable(),
  models: z.array(routeSchema.extend({ usage: tokenUsageStateSchema })),
}).strict()
type ModelUsageState = z.infer<typeof modelUsageStateSchema>

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap { modelUsage: ModelUsageState }
}

/** Replayable per-route usage with the token meter's retry and settlement semantics. */
export const modelUsageProjectionDefinition = {
  key: 'modelUsage',
  stateVersion: 1,
  stateSchema: modelUsageStateSchema,
  init: () => ({ route: null, models: [] }),
  apply: (state, event) => {
    if (event.type === 'request/header') {
      const { provider, model } = event.data.header.config
      return { ...state, route: { provider, model } }
    }
    if (event.type === 'llm/retry-started') {
      const models = state.models.map(entry => ({ ...entry, usage: tokenUsageProjectionDefinition.apply(entry.usage, event) }))
      return { ...state, models }
    }
    if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') return state
    const source = event.type === 'assistant/message' ? event.data.message.source : undefined
    const route = source?.kind === 'model' ? source : state.route
    if (route === null) return state
    const index = state.models.findIndex(entry => entry.provider === route.provider && entry.model === route.model)
    const previous = state.models[index]?.usage ?? tokenUsageProjectionDefinition.init()
    const usage = tokenUsageProjectionDefinition.apply(previous, event)
    if (usage === previous) return state
    const entry = { provider: route.provider, model: route.model, usage }
    const models = [...state.models]
    if (index < 0) models.push(entry)
    else models[index] = entry
    return { ...state, models }
  },
  wire: {
    viewSchema: z.array(routeSchema.extend({ usage: tokenUsageStateSchema.shape.totals })),
    view: state => state.models.map(({ provider, model, usage }) => ({ provider, model, usage: usage.totals })),
  },
} satisfies ProjectionDefinition<'modelUsage', ModelUsageState>

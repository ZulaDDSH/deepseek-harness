import { z } from 'zod'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { JevDecisionRecord } from './types.ts'

const jevDecisionSchema = z.object({
  turn: z.number(),
  step: z.number(),
  choice: z.string().exactOptional(),
  confidence: z.number().exactOptional(),
  route: z.string().exactOptional(),
  provider: z.string().exactOptional(),
  model: z.string().exactOptional(),
  error: z.string().exactOptional(),
  rejected: z.boolean().exactOptional(),
}).strict().nullable()

/** Keeps the latest `jev/decision` so a client can show it without scanning the event window. */
export const jevDecisionProjection = {
  key: 'jevDecision',
  stateVersion: 2,
  stateSchema: jevDecisionSchema,
  init: () => null,
  apply: (state, event) => event.type === 'jev/decision' ? event.data : state,
  wire: { viewSchema: jevDecisionSchema, view: state => state },
} satisfies ProjectionDefinition<'jevDecision', JevDecisionRecord | null>

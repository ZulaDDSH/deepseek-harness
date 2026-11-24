import type { SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionCheckpointRows } from '@deepseek-ai/dsh-session-query'
import { catalogChild, subagentCatalogProjectionDefinition } from './catalog.ts'
import { subagentIdentityProjectionDefinition } from './projection.ts'

export type CreationLink = {
  readonly header: SessionHeader
  readonly identity: { readonly seq: number } | null | undefined
  readonly inheritedEventCount: number
}

export interface CreationParent {
  readonly present: boolean
  readonly name: string | undefined
  readonly link: CreationLink
}

// Constraint: a stored row can lag the log, so it may prove a child present but never absent; undefined means take the full path.
export function creationParentFromCheckpoint(cut: SessionCheckpointRows, childId: SessionId): CreationParent | undefined {
  const catalog = cut.rows[subagentCatalogProjectionDefinition.key]
  const state: unknown = catalog?.val
  if (catalog?.ver !== subagentCatalogProjectionDefinition.stateVersion || typeof state !== 'object' || state === null) return undefined
  const fields = state as { readonly children?: unknown; readonly inheritedEventCount?: unknown }
  if (fields.inheritedEventCount !== cut.inheritedEventCount) return undefined
  const child = catalogChild({ children: fields.children }, childId)
  if (child === undefined) return undefined
  const link = { header: cut.header, inheritedEventCount: cut.inheritedEventCount }
  if (cut.header.parentSession === undefined) return { present: true, name: child.name, link: { ...link, identity: undefined } }
  const row = cut.rows[subagentIdentityProjectionDefinition.key]
  if (row?.ver !== subagentIdentityProjectionDefinition.stateVersion || row.seq < catalog.seq) return undefined
  const identity = subagentIdentityProjectionDefinition.stateSchema.safeParse(row.val)
  if (!identity.success || identity.data.identity === undefined || identity.data.identity.seq < cut.inheritedEventCount) return undefined
  return { present: true, name: child.name, link: { ...link, identity: identity.data.identity } }
}

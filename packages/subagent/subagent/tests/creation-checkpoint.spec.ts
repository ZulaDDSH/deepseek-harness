import { describe, expect, it } from 'vitest'
import { SessionLogOffset, SessionSeq, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import type { ProjectionCheckpoint } from '@deepseek-ai/dsh-session-projection'
import { brandString } from '@deepseek-ai/dsh-brand'
import { subagentCatalogProjectionDefinition } from '../src/catalog.ts'
import { creationParentFromCheckpoint } from '../src/creation-checkpoint.ts'
import { subagentIdentityProjectionDefinition } from '../src/projection.ts'

const childId = brandString<SessionId>('child')
const rootHeader: SessionHeader = {
  version: SESSION_FORMAT_VERSION, id: brandString<SessionId>('creator'), createdAt: 0, isSeeded: false,
}
const nestedHeader: SessionHeader = { ...rootHeader, parentSession: brandString<SessionId>('grandparent') }
const CUT = SessionLogOffset(0)

function catalogRow(childIds: readonly string[], seq = 3, cut = CUT): ProjectionCheckpoint[string] {
  let state = subagentCatalogProjectionDefinition.init(rootHeader, cut)
  childIds.forEach((id, index) => {
    const event: SessionEvent<'subagent/catalog'> = {
      type: 'subagent/catalog',
      seq: SessionSeq(index),
      time: 0,
      data: { version: 3, childId: brandString<SessionId>(id), childCreatedAt: index, mode: 'external', name: `agent-${index + 1}` },
    }
    state = subagentCatalogProjectionDefinition.apply(state, event)
  })
  return { ver: subagentCatalogProjectionDefinition.stateVersion, seq: SessionSeq(seq), val: state }
}

function identityRow(identitySeq: number | undefined, rowSeq = 3): ProjectionCheckpoint[string] {
  return {
    ver: subagentIdentityProjectionDefinition.stateVersion,
    seq: SessionSeq(rowSeq),
    val: identitySeq === undefined ? {} : { identity: { mode: 'continuable', label: 'creator', seq: identitySeq } },
  }
}

function cut(rows: ProjectionCheckpoint, header = rootHeader, inheritedEventCount = CUT) {
  return { header, inheritedEventCount, rows }
}

describe('creationParentFromCheckpoint', () => {
  it('resolves a child of a root creator from the keyed index alone', () => {
    const rows = { subagentCatalog: catalogRow(['other', 'child']) }
    expect(creationParentFromCheckpoint(cut(rows), childId))
      .toEqual({ present: true, name: 'agent-2', link: { header: rootHeader, identity: undefined, inheritedEventCount: 0 } })
  })

  it('reports an unnamed historical child with no name', () => {
    const state = subagentCatalogProjectionDefinition.apply(
      subagentCatalogProjectionDefinition.init(rootHeader, CUT),
      {
        type: 'subagent/catalog',
        seq: SessionSeq(0),
        time: 0,
        data: { version: 0, childId, childCreatedAt: 0, mode: 'continuable', label: 'old' },
      },
    )
    const rows = { subagentCatalog: { ver: subagentCatalogProjectionDefinition.stateVersion, seq: SessionSeq(0), val: state } }
    expect(creationParentFromCheckpoint(cut(rows), childId)?.name).toBeUndefined()
    expect(creationParentFromCheckpoint(cut(rows), childId)?.present).toBe(true)
  })

  it('carries the creator\'s own descriptor identity when the creator is itself a subagent', () => {
    const rows = { subagentCatalog: catalogRow(['child']), subagent: identityRow(1) }
    const parent = creationParentFromCheckpoint(cut(rows, nestedHeader), childId)
    expect(parent?.link.identity).toEqual({ mode: 'continuable', label: 'creator', seq: 1 })
    expect(parent?.link.header).toBe(nestedHeader)
  })

  it.each<[string, (rows: ProjectionCheckpoint) => ProjectionCheckpoint]>([
    ['the child is absent from the row', rows => ({ ...rows, subagentCatalog: catalogRow(['other']) })],
    ['the catalog row is missing', ({ subagentCatalog: _dropped, ...rows }) => rows],
    ['the catalog row is a version-7 row', rows => ({ ...rows, subagentCatalog: { ...catalogRow(['child']), ver: 7 } })],
    ['the catalog row folded another cut', rows => ({ ...rows, subagentCatalog: catalogRow(['child'], 3, SessionLogOffset(2)) })],
    ['the catalog row is not an object', rows => ({ ...rows, subagentCatalog: { ...catalogRow(['child']), val: 'garbage' } })],
    ['the child index is malformed', rows => ({
      ...rows, subagentCatalog: { ...catalogRow(['child']), val: { inheritedEventCount: 0, children: { a: 'x' } } },
    })],
  ])('falls back when %s', (_name, mutate) => {
    const rows = mutate({ subagentCatalog: catalogRow(['child']) })
    expect(creationParentFromCheckpoint(cut(rows), childId)).toBeUndefined()
  })

  it.each<[string, ProjectionCheckpoint[string] | undefined]>([
    ['the identity row is missing', undefined],
    ['the identity row has no identity', identityRow(undefined)],
    ['the identity row is a stale version', { ...identityRow(1), ver: 2 }],
    ['the identity row lags the catalog row', identityRow(1, 2)],
    ['the identity is not the creator\'s own descriptor', identityRow(0)],
    ['the identity row is malformed', { ...identityRow(1), val: { identity: 'creator' } }],
  ])('falls back for a nested creator when %s', (_name, row) => {
    const rows = { subagentCatalog: catalogRow(['child'], 3, SessionLogOffset(1)), ...row === undefined ? {} : { subagent: row } }
    const seeded = { ...nestedHeader, isSeeded: true }
    expect(creationParentFromCheckpoint(cut(rows, seeded, SessionLogOffset(1)), childId)).toBeUndefined()
  })
})

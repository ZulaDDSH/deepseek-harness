import { describe, expect, it } from 'vitest'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import { subagentCatalogProjectionDefinition } from '../src/catalog.ts'
import type { SubagentCatalogState } from '../src/catalog.ts'

const definition = subagentCatalogProjectionDefinition
const wire = definition.wire
const noHeader: SessionHeader = undefined as never

function childEvent(index: number): SessionEvent {
  return {
    type: 'subagent/catalog',
    seq: index,
    data: {
      version: 3,
      childId: `child-${index}`,
      childCreatedAt: 1_000 + index,
      mode: 'external',
      label: `label ${index}`,
      name: `agent-${index + 1}`,
    },
  } as SessionEvent
}

function fold(count: number, visit: (prev: SubagentCatalogState, next: SubagentCatalogState, index: number) => void): SubagentCatalogState {
  let state = definition.init(noHeader, 0 as never) as SubagentCatalogState
  for (let index = 0; index < count; index += 1) {
    const next = definition.apply(state, childEvent(index)) as SubagentCatalogState
    visit(state, next, index)
    state = next
  }
  return state
}

describe('subagent catalog append publication', () => {
  it.each([1, 2, 63, 64, 65, 130])('publishes each creation as exactly the appended entry for %i children', (count) => {
    const published: unknown[] = []
    const end = fold(count, (prev, next, index) => {
      const appended = wire.appended(prev, next)
      expect(appended?.from).toBe(index)
      expect(appended?.items).toHaveLength(1)
      published.push(...appended?.items ?? [])
    })
    expect(published).toEqual(wire.view(end))
  })

  it('keeps each creation frame the same size as the catalog grows', () => {
    const sizes: number[] = []
    fold(1_000, (prev, next) => {
      sizes.push(JSON.stringify(wire.appended(prev, next)?.items ?? []).length)
    })
    expect(new Set(sizes.map(size => Math.floor(size / 10))).size).toBeLessThanOrEqual(2)
    expect(Math.max(...sizes)).toBeLessThan(200)
  })

  it('returns no append for a state that did not grow', () => {
    const end = fold(3, () => {})
    expect(wire.appended(end, end)).toBeUndefined()
  })
})

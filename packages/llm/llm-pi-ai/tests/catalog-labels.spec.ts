import { describe, expect, it } from 'vitest'
import { catalogModels } from '../src/catalog.ts'

describe('catalog display labels', () => {
  it('does not call pinned model entries latest', () => {
    expect([...catalogModels('anthropic').values()].some(model => /\(latest\)/i.test(model.name))).toBe(false)
  })
})

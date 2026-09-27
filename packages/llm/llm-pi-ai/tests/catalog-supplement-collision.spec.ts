import { describe, expect, it, vi } from 'vitest'

// The real supplement table never names an id the installed catalog already
// carries, so `catalogModels`'s installed-entry-wins skip path needs a faked
// collision; isolated here so the fake never leaks into the real supplement's
// own tests in catalog.spec.ts.
vi.mock('../src/catalog-supplement.ts', () => ({
  catalogSupplements: (provider: string) => provider === 'opencode-go'
    ? [{ id: 'deepseek-v4-flash', name: '__fake_supplement_should_not_win__' }]
    : [],
}))

const { catalogModels } = await import('../src/catalog.ts')

describe('catalogModels supplement collision', () => {
  it('keeps the installed catalog entry when a supplement id collides', () => {
    const models = catalogModels('opencode-go')
    expect(models.get('deepseek-v4-flash')?.name).not.toBe('__fake_supplement_should_not_win__')
  })
})

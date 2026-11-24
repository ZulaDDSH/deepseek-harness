import { Context } from '@deepseek-ai/cordis'
import Loader, { EntryTree, type EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import { describe, expect, it, onTestFinished } from 'vitest'

const withId = (options: EntryOptions): EntryOptions => options

class MemoryTree extends EntryTree {
  commit() {}
}

async function fixture() {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(Loader)
  const trees: MemoryTree[] = []
  ctx.loader.builtins.example = () => {}
  ctx.loader.builtins.nest = (nested: Context) => { trees.push(new MemoryTree(nested)) }
  return { loader: ctx.loader, trees }
}

describe('Loader entry lookup with colon-bearing ids', () => {
  it('resolves, updates and removes a root entry by its literal id', async () => {
    const { loader } = await fixture()
    await loader.create(withId({ id: 'pkg:row', name: 'cordis:example', config: { value: 1 } }))
    await loader.await()
    expect(loader.resolve('pkg:row').options.id).toBe('pkg:row')
    await loader.update('pkg:row', { config: { value: 2 } })
    expect(loader.resolve('pkg:row').options.config).toEqual({ value: 2 })
    loader.remove('pkg:row')
    expect(() => loader.resolve('pkg:row')).toThrow('cannot resolve entry pkg:row')
  })

  it('resolves a colon-bearing id inside a nested tree and round-trips Entry.id', async () => {
    const { loader, trees } = await fixture()
    await loader.create(withId({ id: 'outer', name: 'cordis:nest' }))
    await loader.await()
    const [tree] = trees
    await tree!.create(withId({ id: 'pkg:row', name: 'cordis:example' }))
    await tree!.create(withId({ id: 'plain', name: 'cordis:example' }))
    await loader.await()
    const entry = loader.resolve('outer:pkg:row')
    expect(entry.options.id).toBe('pkg:row')
    expect(entry.id).toBe('outer:pkg:row')
    expect(loader.resolve(entry.id)).toBe(entry)
    expect(loader.resolve('outer:plain').options.id).toBe('plain')
    await loader.update('outer:pkg:row', { config: { value: 3 } })
    expect(entry.options.config).toEqual({ value: 3 })
    loader.remove('outer:pkg:row')
    expect(() => loader.resolve('outer:pkg:row')).toThrow('cannot resolve entry outer:pkg:row')
    expect(loader.resolve('outer:plain')).toBeDefined()
  })

  it('prefers a literal id over a nested path and still reaches the path when no literal exists', async () => {
    const { loader, trees } = await fixture()
    await loader.create(withId({ id: 'outer', name: 'cordis:nest' }))
    await loader.await()
    await trees[0]!.create(withId({ id: 'row', name: 'cordis:example' }))
    await loader.await()
    const nested = loader.resolve('outer:row')
    expect(nested.parent.tree).toBe(trees[0])
    await loader.create(withId({ id: 'outer:row', name: 'cordis:example' }))
    await loader.await()
    expect(loader.resolve('outer:row').options.id).toBe('outer:row')
    expect(nested.options.id).toBe('row')
  })
})

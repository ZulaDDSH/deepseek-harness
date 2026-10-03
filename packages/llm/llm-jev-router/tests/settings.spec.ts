/** Real settings projection and edits for the Jev schema. */
import type { Volatile } from '@deepseek-ai/cordis'
import { expect, it } from 'vitest'
import { configurationFixture } from '../../../settings/settings/tests/configuration-fixture.ts'
import { Config, type Config as JevConfig } from '../src/index.ts'

it('exposes Jev settings and preserves its live reference through edits', async () => {
  const references: Volatile<JevConfig>[] = []
  const { ctx } = await configurationFixture({ schema: Config, hmr: false,
    apply: (_ctx, config) => { references.push(config as Volatile<JevConfig>) },
  })
  const before = ctx.settings.describe().find(row => row.ns === 'first')!
  expect(before.value).toMatchObject({ enabled: false, model: 'jev-latest', routes: [] })
  const entry = ctx.configEditor.entries().find(row => row.options.id === 'first')!
  const fiber = entry.fiber
  const first = entry.fiber!.config as Volatile<JevConfig>
  await ctx.settings.mutate('first', [{ op: 'set', path: ['enabled'], value: true }])
  expect(entry.fiber).toBe(fiber)
  expect(first.get().enabled).toBe(true)
  expect(ctx.settings.describe().find(row => row.ns === 'first')!.value).toMatchObject({ enabled: true })
  expect(references).toContain(first)
})

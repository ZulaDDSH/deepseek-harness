/** The Web bundle turns full-text session search on over a durable per-profile index. */
import { fileURLToPath } from 'node:url'
import { loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { expect, it } from 'vitest'

it('defers the session search index to the first search on a per-profile cache path', () => {
  const rows = loadOverlayPatches('session-search', fileURLToPath(new URL('../cordis.patch.yml', import.meta.url)))
    .filter(patch => patch.id === 'session-query-sqlite')
  expect(rows).toHaveLength(1)
  expect(rows[0]!.config).toMatchObject({
    openAt: 'first-search',
    path: { __jsExpr: expect.stringContaining("dshHomePath('cache', 'session-query'") as string },
  })
})

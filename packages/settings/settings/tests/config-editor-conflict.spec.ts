import { readFileSync, writeFileSync } from 'node:fs'
import { expect, it, vi } from 'vitest'
import { configurationFixture as fixture } from './configuration-fixture.ts'

const hook = vi.hoisted(() => ({ afterRead: undefined as undefined | (() => void) }))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  const wrapped = (async (...args: Parameters<typeof actual.readFile>) => {
    const result = await actual.readFile(...args)
    const run = hook.afterRead
    if (run !== undefined && String(args[0]).endsWith('cordis.patch.yml')) {
      hook.afterRead = undefined
      run()
    }
    return result
  }) as typeof actual.readFile
  return { ...actual, default: { ...actual, readFile: wrapped }, readFile: wrapped }
})

const EXTERNAL = '- id: second\n  config:\n    ordinary: external\n'

it('refuses to overwrite a profile edit saved while the change was prepared', async () => {
  const { ctx, profile } = await fixture({ hmr: false })
  const entry = ctx.configEditor.entries().find(row => row.options.id === 'first')!
  hook.afterRead = () => { writeFileSync(profile.patchPath, EXTERNAL) }
  await expect(ctx.configEditor.edit(entry, raw => ({ ...raw, count: 9 }))).rejects.toThrow('edited while the change was prepared')
  expect(readFileSync(profile.patchPath, 'utf8')).toBe(EXTERNAL)
})

it('keeps a profile edit saved during a failed reconciliation instead of rolling back over it', async () => {
  const { ctx, profile } = await fixture({ hmr: false, apply: (_ctx, config) => {
    if ((config as { ordinary: string }).ordinary === 'rejected') {
      writeFileSync(profile.patchPath, EXTERNAL)
      throw new Error('activation refused')
    }
  } })
  const entry = ctx.configEditor.entries().find(row => row.options.id === 'first')!
  await expect(ctx.configEditor.edit(entry, raw => ({ ...raw, ordinary: 'rejected' }))).rejects.toThrow('edited during reconciliation')
  expect(readFileSync(profile.patchPath, 'utf8')).toBe(EXTERNAL)
})

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SettingsDirectory } from '@deepseek-ai/dsh-client-ui-settings/src/client/settings-directory.ts'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en, zh } from '../src/client/locales.ts'
import { modelsSearchEntries } from '../src/client/search-entries.ts'

function directory(dictionary: typeof en | typeof zh) {
  const dir = new SettingsDirectory(new Context())
  dir.register(modelsSearchEntries(makeTranslate(dictionary)))
  return dir
}

describe('Models and Jev search entries', () => {
  it('finds provider and routing settings by their labels, descriptions and aliases', () => {
    const dir = directory(en)
    expect(dir.search('api key').map(item => [item.section, item.label])).toContainEqual(['models', 'API key'])
    expect(dir.search('relay').map(item => item.id)).toEqual(['models.custom-api'])
    expect(dir.search('timeout').map(item => item.id)).toContain('jev.timeout')
    expect(dir.search('minimum confidence').map(item => item.id)).toEqual(['jev.min-confidence'])
  })

  it('files every entry under a page the package registers and speaks the active locale', () => {
    const dir = directory(zh)
    const sections = new Set(dir.list().map(entry => entry.section))
    expect([...sections].sort()).toEqual(['jev', 'models'])
    expect(dir.search('路由').length).toBeGreaterThan(3)
    expect(dir.search('路由').every(item => item.description !== '')).toBe(true)
  })
})

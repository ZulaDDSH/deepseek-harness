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

describe('Models search entries', () => {
  it('finds provider settings by their labels, descriptions and aliases', () => {
    const dir = directory(en)
    expect(dir.search('api key').map(item => [item.section, item.label])).toContainEqual(['models', 'API key'])
    expect(dir.search('relay').map(item => item.id)).toEqual(['models.custom-api'])
  })

  it('files every entry under a page the package registers and speaks the active locale', () => {
    const dir = directory(zh)
    const sections = new Set(dir.list().map(entry => entry.section))
    expect([...sections].sort()).toEqual(['models'])
    expect(dir.search('API').every(item => item.description !== '')).toBe(true)
  })
})

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SettingsDirectory } from '../src/client/settings-directory.ts'

function directory(): SettingsDirectory {
  return new SettingsDirectory(new Context())
}

describe('SettingsDirectory', () => {
  it('rejects a duplicate id and adds none of the batch', () => {
    const dir = directory()
    dir.register([{ id: 'a', section: 's', label: 'A' }])
    expect(() => dir.register([{ id: 'b', section: 's', label: 'B' }, { id: 'a', section: 's', label: 'A2' }]))
      .toThrow("Settings directory entry 'a' is already registered")
    expect(dir.list().map(entry => entry.id)).toEqual(['a'])
    expect(() => dir.register([{ id: 'c', section: 's', label: 'C' }, { id: 'c', section: 's', label: 'C' }])).toThrow()
    expect(dir.list().map(entry => entry.id)).toEqual(['a'])
  })

  it('removes exactly the registered entries and notifies subscribers', () => {
    const dir = directory()
    const listener = vi.fn()
    dir.subscribe(listener)
    const offA = dir.register([{ id: 'a', section: 's', label: 'A' }])
    const offB = dir.register([{ id: 'b', section: 's', label: 'B' }])
    const version = dir.getVersion()
    offA()
    expect(dir.list().map(entry => entry.id)).toEqual(['b'])
    expect(dir.getVersion()).toBeGreaterThan(version)
    offA()
    expect(listener).toHaveBeenCalledTimes(3)
    offB()
    expect(dir.list()).toEqual([])
  })

  it('finds by label, keywords and description with every word required, and ranks label hits first', () => {
    const dir = directory()
    dir.register([
      { id: 'theme', section: 'general', label: 'Appearance', description: 'Light or dark', keywords: 'theme colour' },
      { id: 'font', section: 'general', label: 'Font size', description: 'Only affects conversation content' },
      { id: 'dark-label', section: 'general', label: 'Dark mode helper' },
    ])
    expect(dir.search('')).toEqual([])
    expect(dir.search('   ')).toEqual([])
    expect(dir.search('THEME').map(item => item.id)).toEqual(['theme'])
    expect(dir.search('conversation').map(item => item.id)).toEqual(['font'])
    expect(dir.search('dark').map(item => item.id)).toEqual(['dark-label', 'theme'])
    expect(dir.search('font conversation').map(item => item.id)).toEqual(['font'])
    expect(dir.search('font light')).toEqual([])
    expect(dir.search('zzz')).toEqual([])
  })

  it('matches CJK text and re-reads thunked text on every search', () => {
    const dir = directory()
    let label = '外观'
    dir.register([{ id: 'theme', section: 'general', label: () => label, anchor: 'appearance' }])
    expect(dir.search('外观')).toEqual([
      { id: 'theme', section: 'general', label: '外观', description: '', keywords: '', anchor: 'appearance' },
    ])
    label = 'Appearance'
    expect(dir.search('外观')).toEqual([])
    expect(dir.search('appear')).toHaveLength(1)
  })

  it('hides an entry while its when() is false and returns nothing for a blank query', () => {
    const dir = directory()
    let present = false
    dir.register([{ id: 'link', section: 'general', label: 'Link opening', when: () => present }])
    expect(dir.search('link')).toEqual([])
    present = true
    expect(dir.search('link').map(item => item.id)).toEqual(['link'])
    expect(dir.search('  ')).toEqual([])
  })

  it('requires exactly one of section and link and adds none of a bad batch', () => {
    const dir = directory()
    expect(() => dir.register([{ id: 'x', label: 'X' }]))
      .toThrow("Settings directory entry 'x' must set exactly one of section and link")
    expect(() => dir.register([
      { id: 'ok', section: 's', label: 'Ok' },
      { id: 'both', section: 's', link: { place: 'P', open: () => {} }, label: 'Both' },
    ])).toThrow()
    expect(dir.list()).toEqual([])
  })

  it('resolves a link entry for search without a section', () => {
    const dir = directory()
    const open = vi.fn()
    dir.register([{ id: 'web', link: { place: () => 'Plugins', open }, label: 'Web search', description: 'Search provider' }])
    const [hit] = dir.search('web')
    expect(hit).toMatchObject({ id: 'web', section: undefined, label: 'Web search', link: { place: 'Plugins' } })
    hit!.link!.open()
    expect(open).toHaveBeenCalledTimes(1)
  })
})

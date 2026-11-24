import { describe, expect, it } from 'vitest'
import { de, en, es, fr, ja, pt, ru, zh } from '../src/client/locales.ts'

describe('translation service names', () => {
  it.each(Object.entries({ en, zh, ja, es, fr, de, ru, pt }))('name distinct services in the %s dictionary', (name, dictionary) => {
    expect(dictionary.google).not.toBe(dictionary.bing)
    if (name === 'ru') return
    expect(dictionary.google.toLowerCase()).toContain('google')
    expect(dictionary.bing.toLowerCase()).toContain('bing')
  })
})

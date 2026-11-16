import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  collectEvents,
  collectServices,
  type CordisCatalogPolicy,
} from '../src/cordis-catalog.ts'

const POLICY: CordisCatalogPolicy = {
  linkedTypePages: {},
  foundationTypeNames: new Set(['Promise']),
  typeLinkExemptions: {},
  inheritedEvents: [],
  inheritedServices: [],
}

const roots: string[] = []
const EVENT_ANCHOR = 'packages/group/fix/src/index.ts:fix/happened'
const SERVICE_METHOD_ANCHOR = 'packages/group/fix/src/index.ts:FixService.poke'

function fixture(
  event = "    'fix/happened'(): void",
  service = '/** Fixture service. */\nexport class FixService { poke(): void {} }',
): string {
  const root = mkdtempSync(join(tmpdir(), 'cordis-code-notes-'))
  roots.push(root)
  const packageRoot = join(root, 'packages', 'group', 'fix')
  const sourceRoot = join(packageRoot, 'src')
  mkdirSync(sourceRoot, { recursive: true })
  writeFileSync(join(root, 'tsconfig.host.json'), JSON.stringify({
    files: [],
    references: [{ path: './packages/group/fix' }],
  }))
  writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({
    name: '@fixture/fix',
    private: true,
    type: 'module',
    exports: { '.': { types: './lib/types/index.d.ts', default: './lib/index.js' } },
  }))
  writeFileSync(join(packageRoot, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      composite: true,
      module: 'ESNext',
      moduleResolution: 'Bundler',
      rootDir: 'src',
      target: 'ES2022',
    },
    include: ['src'],
  }))
  writeFileSync(join(sourceRoot, 'index.ts'), [
    "declare module '@deepseek-ai/cordis' {",
    '  interface Events {',
    event,
    '  }',
    '  interface Context { fix: FixService }',
    '}',
    service,
  ].join('\n'))
  return root
}

function policy(anchor: string, fields: Record<string, string>): CordisCatalogPolicy {
  const codeNotes = new Map([
    [EVENT_ANCHOR, new Map([
      ['description', 'A fixture event.'],
      ['mode', 'emit'],
    ])],
    [SERVICE_METHOD_ANCHOR, new Map([['description', 'A fixture service method.']])],
  ])
  codeNotes.set(anchor, new Map(Object.entries(fields)))
  return {
    ...POLICY,
    codeNotes,
  }
}

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})

describe('Cordis code-note contracts', () => {
  it('uses code notes when an event has no source JSDoc', () => {
    const entries = collectEvents(fixture(), policy(
      EVENT_ANCHOR,
      { description: 'A thing happened.', mode: 'emit' },
    ))

    expect(entries[0]).toMatchObject({ doc: 'A thing happened.', mode: 'emit' })
    expect(entries[0]?.jsDoc).toContain('A thing happened.')
  })

  it('fails when an event has neither source JSDoc nor code notes', () => {
    expect(() => collectEvents(fixture(), POLICY)).toThrow(/has no description prose/)
  })

  it('fails closed when event code notes omit the required description', () => {
    expect(() => collectEvents(fixture(), policy(
      EVENT_ANCHOR,
      { mode: 'emit' },
    ))).toThrow(/has no description prose/)
  })

  it('keeps event source JSDoc ahead of code notes', () => {
    const entries = collectEvents(fixture([
      '    /**',
      '     * Source event.',
      '     * @mode emit',
      '     */',
      "    'fix/happened'(): void",
    ].join('\n')), policy(
      EVENT_ANCHOR,
      { description: 'Fallback event.' },
    ))

    expect(entries[0]?.doc).toBe('Source event.')
    expect(entries[0]?.jsDoc).toContain('Source event.')
  })

  it('uses code notes when a service member has no source JSDoc', () => {
    const entries = collectServices(fixture(), policy(
      SERVICE_METHOD_ANCHOR,
      { description: 'Fire and forget.' },
    ))

    expect(entries[0]?.methods[0]?.jsDoc).toContain('Fire and forget.')
  })

  it('fails when a service member has neither source JSDoc nor code notes', () => {
    expect(() => collectServices(fixture(), policy(SERVICE_METHOD_ANCHOR, {})))
      .toThrow(/ctx\.fix\.poke .* has no JSDoc/)
  })

  it('keeps service member source JSDoc ahead of code notes', () => {
    const entries = collectServices(fixture(undefined, [
      '/** Fixture service. */',
      'export class FixService {',
      '  /** Source method. */',
      '  poke(): void {}',
      '}',
    ].join('\n')), policy(
      SERVICE_METHOD_ANCHOR,
      { description: 'Fallback method.' },
    ))

    expect(entries[0]?.methods[0]?.jsDoc).toContain('Source method.')
    expect(entries[0]?.methods[0]?.jsDoc).not.toContain('Fallback method.')
  })
})

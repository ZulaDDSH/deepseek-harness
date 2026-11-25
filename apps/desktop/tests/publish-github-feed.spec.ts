import { readFileSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { load } from 'js-yaml'
import { describe, expect, it, vi } from 'vitest'
import { publishGithubFeed, rewriteFeedMetadata } from '../scripts/publish-github-feed.mjs'

const REPOSITORY = 'ZulaDDSH/deepseek-harness'
const EXE = 'deepseek-harness-0.2.2-rc.3.20261124.1-win-x64-unsigned.exe'
const METADATA = `version: 0.2.2-rc.3.20261124.1
files:
  - url: ${EXE}
    sha512: abc123==
    size: 426427404
    blockMapSize: 4321
path: ${EXE}
sha512: abc123==
releaseDate: '2026-11-24T23:36:28.000Z'
`

async function withDirectory(files: Record<string, string>, action: (directory: string) => void): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'github-feed-'))
  try {
    for (const [name, content] of Object.entries(files)) await writeFile(join(directory, name), content)
    action(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

describe('GitHub update feed metadata', () => {
  it('rewrites every file url and the path to the absolute versioned asset URL', () => {
    const result = rewriteFeedMetadata(METADATA, REPOSITORY)
    const url = `https://github.com/${REPOSITORY}/releases/download/v0.2.2-rc.3.20261124.1/${EXE}`
    expect(result).toMatchObject({ version: '0.2.2-rc.3.20261124.1', tag: 'v0.2.2-rc.3.20261124.1', assets: [EXE] })
    expect(load(result.yaml)).toEqual({
      version: '0.2.2-rc.3.20261124.1',
      files: [{ url, sha512: 'abc123==', size: 426427404, blockMapSize: 4321 }],
      path: url,
      sha512: 'abc123==',
      releaseDate: '2026-11-24T23:36:28.000Z',
    })
  })

  it('accepts an already absolute or encoded url and omits an absent path', () => {
    const result = rewriteFeedMetadata(`version: 1.0.0\nfiles:\n  - url: https://old.example.com/dir/${EXE}\n    sha512: x\n    size: 1\n`, REPOSITORY)
    expect(load(result.yaml)).toMatchObject({ files: [{ url: `https://github.com/${REPOSITORY}/releases/download/v1.0.0/${EXE}` }] })
    expect(load(result.yaml)).not.toHaveProperty('path')
  })

  it.each([
    ['a name GitHub would rename', 'version: 1.0.0\nfiles:\n  - url: DeepSeek%20Harness.exe\n    sha512: x\n    size: 1\n'],
    ['a missing version', `files:\n  - url: ${EXE}\n`],
    ['no files', 'version: 1.0.0\nfiles: []\n'],
    ['a non-object document', '- a\n'],
  ])('rejects %s', (_label, text) => {
    expect(() => rewriteFeedMetadata(text, REPOSITORY)).toThrow('publish github feed')
  })
})

describe('GitHub update feed publication', () => {
  const files = { 'nightly.yml': METADATA, [EXE]: 'x', [`${EXE}.blockmap`]: 'y', 'SHA256SUMS.txt': 'z' }

  it('uploads installer, blockmap and checksums before the feed metadata and creates missing releases', async () => {
    await withDirectory(files, (directory) => {
      const calls: string[][] = []
      const missing = (args: string[]) => { calls.push(args); if (args[1] === 'view') throw Object.assign(new Error('failed'), { stderr: 'release not found' }) }
      const result = publishGithubFeed({ directory, repository: REPOSITORY, gh: missing as never, log: () => undefined })
      const summary = calls.map(args => args.slice(0, 3).join(' '))
      expect(summary).toEqual([
        'release view v0.2.2-rc.3.20261124.1', 'release create v0.2.2-rc.3.20261124.1',
        'release upload v0.2.2-rc.3.20261124.1',
        'release view desktop-feed', 'release create desktop-feed',
        'release upload desktop-feed',
      ])
      expect(calls[2]).toEqual(expect.arrayContaining([join(directory, EXE), join(directory, `${EXE}.blockmap`), join(directory, 'SHA256SUMS.txt'), '--clobber']))
      expect(calls[2]).not.toContain(join(directory, 'nightly.yml'))
      expect(calls[5]?.slice(3, 5).map(file => basename(file))).toEqual(['nightly.yml', 'stable.yml'])
      expect(result.feedFiles).toEqual(['nightly.yml', 'stable.yml'])
      expect(result.uploaded).toEqual([EXE, `${EXE}.blockmap`, 'SHA256SUMS.txt'])
    })
  })

  it('uploads the same rewritten metadata under both channel names', async () => {
    await withDirectory(files, (directory) => {
      const contents: string[] = []
      const gh = (args: string[]) => {
        if (args[1] === 'upload' && args[2] === 'desktop-feed') contents.push(...args.slice(3, 5).map(file => readFileSync(file, 'utf8')))
      }
      const result = publishGithubFeed({ directory, repository: REPOSITORY, gh: gh as never, log: () => undefined })
      expect(contents).toEqual([result.yaml, result.yaml])
    })
  })

  it('never touches the feed when the versioned upload fails', async () => {
    await withDirectory(files, (directory) => {
      const calls: string[][] = []
      const gh = (args: string[]) => {
        calls.push(args)
        if (args[1] === 'upload' && args[2] === 'v0.2.2-rc.3.20261124.1') throw new Error('upload failed')
      }
      expect(() => publishGithubFeed({ directory, repository: REPOSITORY, gh: gh as never, log: () => undefined })).toThrow('upload failed')
      expect(calls.some(args => args.includes('desktop-feed'))).toBe(false)
    })
  })

  it('skips creation for releases that exist and tolerates a missing blockmap', async () => {
    await withDirectory({ 'nightly.yml': METADATA, [EXE]: 'x' }, (directory) => {
      const calls: string[][] = []
      const log = vi.fn()
      publishGithubFeed({ directory, repository: REPOSITORY, gh: ((args: string[]) => { calls.push(args) }) as never, log })
      expect(calls.map(args => args.slice(0, 2).join(' '))).toEqual(['release view', 'release upload', 'release view', 'release upload'])
      expect(log).toHaveBeenCalledWith(expect.stringContaining('.blockmap is missing'))
    })
  })

  it('does not hide a failed release lookup', async () => {
    await withDirectory(files, (directory) => {
      const failing = () => { throw Object.assign(new Error('network down'), { stderr: 'connection refused' }) }
      expect(() => publishGithubFeed({ directory, repository: REPOSITORY, gh: failing as never, log: () => undefined })).toThrow('network down')
    })
  })

  it('rejects metadata naming an installer that is not in the directory', async () => {
    await withDirectory({ 'nightly.yml': METADATA }, (directory) => {
      const gh = vi.fn()
      expect(() => publishGithubFeed({ directory, repository: REPOSITORY, gh, log: () => undefined })).toThrow(`${EXE} is not in`)
      expect(gh).not.toHaveBeenCalled()
    })
  })

  it('prints the planned commands and rewritten metadata in a dry run without calling gh', async () => {
    await withDirectory(files, (directory) => {
      const gh = vi.fn()
      const lines: string[] = []
      publishGithubFeed({ directory, repository: REPOSITORY, dryRun: true, gh, log: line => lines.push(line) })
      expect(gh).not.toHaveBeenCalled()
      const output = lines.join('\n')
      expect(output).toContain('gh release create v0.2.2-rc.3.20261124.1')
      expect(output).toContain('gh release create desktop-feed')
      expect(output).toContain('<temporary>/nightly.yml <temporary>/stable.yml')
      expect(output).toContain(`url: https://github.com/${REPOSITORY}/releases/download/v0.2.2-rc.3.20261124.1/${EXE}`)
      expect(output.indexOf('gh release upload v0.2.2')).toBeLessThan(output.indexOf('gh release upload desktop-feed'))
    })
  })
})

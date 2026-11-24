/**
 * Git knowledge source against disposable repositories: resolve a ref to a
 * commit, select the configured paths, and prove the recorded commit changes
 * when the source advances.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'
import { cloneSource, listSourceFiles, resolveGitSource } from '../src/index.ts'

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

const run = promisify(execFile)

let workdir: string
let repo: string

/** Run one Git command in the disposable repository. */
async function git(args: string[]): Promise<string> {
  const { stdout } = await run('git', ['-c', 'user.email=test@example.com', '-c', 'user.name=Test', ...args], { cwd: repo })
  return stdout.trim()
}

/** Commit one file into the disposable repository. */
async function commitFile(path: string, content: string, message: string): Promise<string> {
  const full = join(repo, path)
  await mkdir(join(full, '..'), { recursive: true })
  await writeFile(full, content, 'utf8')
  await git(['add', path])
  await git(['commit', '-m', message])
  return await git(['rev-parse', 'HEAD'])
}

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'dsh-knowledge-git-'))
  repo = join(workdir, 'garden-knowledge')
  await mkdir(repo, { recursive: true })
  await git(['init', '-b', 'master'])
  await git(['config', 'user.name', ''])
  await git(['config', 'user.email', ''])
})

afterEach(async () => {
  vi.restoreAllMocks()
  // Git leaves pack and index files briefly mapped on Windows, so a concurrent
  // run can lose the race against teardown; retry rather than fail the spec.
  await rm(workdir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

describe('git knowledge source', () => {
  it.each(['master', 'refs/heads/master', 'origin/master'])('advances the same remote branch source (%s)', async (ref) => {
    const first = await commitFile('knowledge/note.md', 'first', 'first')
    const remote = pathToFileURL(repo).href
    const checkoutDir = join(workdir, 'new-checkout')
    const source = { repo: remote, ref, paths: ['knowledge/**'], checkoutDir }
    expect((await resolveGitSource(source)).commit).toBe(first)
    const second = await commitFile('knowledge/note.md', 'second', 'second')
    expect((await resolveGitSource(source)).commit).toBe(second)
    expect(await run('git', ['rev-parse', 'HEAD'], { cwd: checkoutDir }).then(result => result.stdout.trim())).toBe(second)
  })

  it('uses the default checkout directory and reports an invalid checkout ref', async () => {
    await commitFile('knowledge/note.md', 'first', 'first')
    vi.spyOn(process, 'cwd').mockReturnValue(workdir)
    const remote = pathToFileURL(repo).href
    const resolved = await resolveGitSource({ repo: remote, ref: 'master', paths: [] })
    expect(resolved.root).toBe(join(workdir, '.dsh-knowledge', createHash('sha256').update(remote).digest('hex')))
    await expect(resolveGitSource({ repo, ref: 'missing-ref', paths: [] })).rejects.toThrow(/git rev-parse failed:/)
    expect(cloneSource('./local')).toBe('./local')
  })

  it('rejects an existing checkout from another repository without changing it', async () => {
    const first = await commitFile('knowledge/note.md', 'first', 'first')
    const checkoutDir = join(workdir, 'shared-checkout')
    const remote = pathToFileURL(repo).href
    await resolveGitSource({ repo: remote, ref: 'master', paths: [], checkoutDir })
    const other = join(workdir, 'other-repository')
    await run('git', ['clone', '-q', repo, other])
    await expect(resolveGitSource({ repo: pathToFileURL(other).href, ref: 'master', paths: [], checkoutDir }))
      .rejects.toThrow(/different origin/)
    expect(await run('git', ['config', '--get', 'remote.origin.url'], { cwd: checkoutDir }).then(result => result.stdout.trim())).toBe(remote)
    expect(await run('git', ['rev-parse', 'HEAD'], { cwd: checkoutDir }).then(result => result.stdout.trim())).toBe(first)
  })

  it('gives repositories with colliding sanitized names separate default checkouts', async () => {
    await commitFile('knowledge/note.md', 'first', 'first')
    const nested = join(workdir, 'source', 'repo')
    const flat = join(workdir, 'source_repo')
    await mkdir(join(workdir, 'source'))
    await run('git', ['clone', '-q', repo, nested])
    await run('git', ['clone', '-q', repo, flat])
    const a = pathToFileURL(nested).href
    const b = pathToFileURL(flat).href
    expect(a.replace(/[^A-Za-z0-9._-]/gu, '_')).toBe(b.replace(/[^A-Za-z0-9._-]/gu, '_'))
    vi.spyOn(process, 'cwd').mockReturnValue(workdir)
    const first = await resolveGitSource({ repo: a, ref: 'master', paths: [] })
    const second = await resolveGitSource({ repo: b, ref: 'master', paths: [] })
    expect(second.root).not.toBe(first.root)
    expect(await run('git', ['config', '--get', 'remote.origin.url'], { cwd: second.root }).then(result => result.stdout.trim())).toBe(b)
  })

  it('clones the default checkout inside another Git work tree', async () => {
    const first = await commitFile('knowledge/note.md', 'first', 'first')
    vi.spyOn(process, 'cwd').mockReturnValue(repo)
    const remote = pathToFileURL(repo).href
    const resolved = await resolveGitSource({ repo: remote, ref: 'master', paths: [] })
    expect(resolved.commit).toBe(first)
    expect(await run('git', ['config', '--get', 'remote.origin.url'], { cwd: resolved.root }).then(result => result.stdout.trim())).toBe(remote)
    expect(await git(['remote'])).toBe('')
  })

  it('resolves a local checkout to its exact commit', async () => {
    const commit = await commitFile('decisions/adr-001.md', '# ADR 001\nUse SQLite.', 'add adr')
    const resolved = await resolveGitSource({ repo, ref: 'master', paths: ['decisions/**'] })
    expect(resolved.commit).toBe(commit)
    expect(resolved.root).toBe(repo)
  })

  it('selects only the configured paths', async () => {
    await commitFile('decisions/adr-001.md', '# ADR 001', 'add adr')
    await commitFile('knowledge/notes.md', '# Notes', 'add notes')
    await commitFile('src/ignored.ts', 'export {}', 'add source')

    const resolved = await resolveGitSource({ repo, ref: 'master', paths: ['decisions/**', 'knowledge/**'] })
    const files = await listSourceFiles(resolved, ['decisions/**', 'knowledge/**'])
    expect(files.sort()).toEqual(['decisions/adr-001.md', 'knowledge/notes.md'])
    expect(files).not.toContain('src/ignored.ts')
  })

  it('lists tracked names exactly, including non-ASCII and leading spaces', async () => {
    const names = ['knowledge/café.md', 'knowledge/日本語.md', 'knowledge/ spaced.md']
    for (const name of names) await commitFile(name, name, `add ${name}`)
    const resolved = await resolveGitSource({ repo, ref: 'master', paths: [] })
    expect((await listSourceFiles(resolved, ['knowledge/**'])).sort()).toEqual([...names].sort())
    await rm(join(repo, 'knowledge'), { recursive: true })
    await git(['add', '-A'])
    await git(['commit', '-m', 'flatten'])
    await commitFile(' lead.md', 'x', 'leading')
    const flat = await resolveGitSource({ repo, ref: 'master', paths: [] })
    expect(await listSourceFiles(flat, [])).toEqual([' lead.md'])
  })

  it.skipIf(process.platform === 'win32')('lists names with tabs, newlines, and trailing spaces exactly', async () => {
    const names = ['a\tb.md', 'line\nbreak.md', 'trail .md', 'end ']
    for (const name of names) await commitFile(name, name, `add ${JSON.stringify(name)}`)
    const resolved = await resolveGitSource({ repo, ref: 'master', paths: [] })
    expect((await listSourceFiles(resolved, [])).sort()).toEqual([...names].sort())
  })

  it('reports the new commit after the source changes', async () => {
    const first = await commitFile('knowledge/runbook.md', '# Runbook v1', 'runbook v1')
    const before = await resolveGitSource({ repo, ref: 'master', paths: ['knowledge/**'] })
    expect(before.commit).toBe(first)

    const second = await commitFile('knowledge/runbook.md', '# Runbook v2', 'runbook v2')
    const after = await resolveGitSource({ repo, ref: 'master', paths: ['knowledge/**'] })

    // The commit advanced, so a stale record is detectable by comparison.
    expect(after.commit).toBe(second)
    expect(after.commit).not.toBe(before.commit)
  })

  it('resolves a tag ref, so a knowledge source can pin a release', async () => {
    const commit = await commitFile('decisions/adr-002.md', '# ADR 002', 'add adr')
    await git(['tag', 'v1.0.0'])
    const resolved = await resolveGitSource({ repo, ref: 'v1.0.0', paths: ['decisions/**'] })
    expect(resolved.commit).toBe(commit)
  })

  it.each(['tag', 'qualified tag', 'sha'])('keeps a remote %s pin after upstream advances', async (kind) => {
    const first = await commitFile('knowledge/note.md', 'first', 'first')
    await git(['tag', '-a', 'v1.0.0', '-m', 'release'])
    await git(['branch', 'v1.0.0', first])
    await git(['branch', first, first])
    const ref = kind === 'tag' ? 'v1.0.0' : kind === 'qualified tag' ? 'refs/tags/v1.0.0' : first
    const source = { repo: pathToFileURL(repo).href, ref, paths: [], checkoutDir: join(workdir, 'pinned') }
    expect((await resolveGitSource(source)).commit).toBe(first)
    const second = await commitFile('knowledge/note.md', 'second', 'second')
    await git(['update-ref', 'refs/heads/v1.0.0', second])
    await git(['update-ref', `refs/heads/${first}`, second])
    expect((await resolveGitSource(source)).commit).toBe(first)
  })

  it.each(['tag', 'sha'])('pins a local %s despite colliding local branches', async (kind) => {
    const first = await commitFile('knowledge/note.md', 'first', 'first')
    const second = await commitFile('knowledge/note.md', 'second', 'second')
    await git(['tag', 'v1.0.0', first])
    await git(['branch', 'v1.0.0', second])
    await git(['branch', first, second])
    expect((await resolveGitSource({ repo, ref: kind === 'tag' ? 'v1.0.0' : first, paths: [] })).commit).toBe(first)
  })

  it.each(['unstaged', 'staged'])('refuses a local checkout with %s tracked edits and leaves it untouched', async (kind) => {
    await commitFile('knowledge/note.md', 'first', 'first')
    const second = await commitFile('knowledge/note.md', 'second', 'second')
    await git(['branch', 'other', 'HEAD~1'])
    await writeFile(join(repo, 'knowledge/note.md'), 'my edit', 'utf8')
    if (kind === 'staged') await git(['add', 'knowledge/note.md'])
    await expect(resolveGitSource({ repo, ref: 'other', paths: [] })).rejects.toThrow(/uncommitted changes/)
    expect(await readFile(join(repo, 'knowledge/note.md'), 'utf8')).toBe('my edit')
    expect(await git(['symbolic-ref', 'HEAD'])).toBe('refs/heads/master')
    expect(await git(['rev-parse', 'HEAD'])).toBe(second)
  })

  it('keeps the caller branch attached when the local checkout already is at the commit', async () => {
    const first = await commitFile('knowledge/note.md', 'first', 'first')
    await writeFile(join(repo, 'untracked.txt'), 'scratch', 'utf8')
    expect((await resolveGitSource({ repo, ref: 'master', paths: [] })).commit).toBe(first)
    expect(await git(['symbolic-ref', 'HEAD'])).toBe('refs/heads/master')
    expect(await readFile(join(repo, 'untracked.txt'), 'utf8')).toBe('scratch')
  })

  it('moves a clean local checkout to another ref without forcing', async () => {
    const first = await commitFile('knowledge/note.md', 'first', 'first')
    await commitFile('knowledge/note.md', 'second', 'second')
    await git(['tag', 'v1', first])
    expect((await resolveGitSource({ repo, ref: 'v1', paths: [] })).commit).toBe(first)
    expect(await git(['rev-parse', 'HEAD'])).toBe(first)
  })

  it('fails the sync when the configured remote cannot be fetched instead of using a stale tracking ref', async () => {
    await commitFile('knowledge/note.md', 'first', 'first')
    const clone = join(workdir, 'local-clone')
    await run('git', ['clone', '-q', repo, clone])
    await run('git', ['remote', 'set-url', 'origin', join(workdir, 'deleted-origin')], { cwd: clone })
    await expect(resolveGitSource({ repo: clone, ref: 'master', paths: [] })).rejects.toThrow(/git fetch failed/)
  })

  it('returns an absolute root for a relative local source and a relative checkoutDir', async () => {
    const first = await commitFile('knowledge/note.md', 'first', 'first')
    vi.spyOn(process, 'cwd').mockReturnValue(workdir)
    const local = await resolveGitSource({ repo: './garden-knowledge', ref: 'master', paths: [] })
    expect(local.root).toBe(repo)
    expect(local.commit).toBe(first)
    const cloned = await resolveGitSource({ repo: pathToFileURL(repo).href, ref: 'master', paths: [], checkoutDir: './relative-checkout' })
    expect(cloned.root).toBe(join(workdir, 'relative-checkout'))
    expect(cloned.commit).toBe(first)
  })

  it('refuses to list a resolution whose checkout has since moved to another commit', async () => {
    await commitFile('knowledge/note.md', 'first', 'first')
    const stale = await resolveGitSource({ repo, ref: 'master', paths: [] })
    await commitFile('knowledge/note.md', 'second', 'second')
    await expect(listSourceFiles(stale, [])).rejects.toThrow(/moved to .* after it was resolved at/)
  })

  it('keeps concurrent resolutions of one checkout consistent with their own refs', async () => {
    const first = await commitFile('knowledge/note.md', 'first', 'first')
    await git(['tag', 'v1', first])
    const second = await commitFile('knowledge/note.md', 'second', 'second')
    await git(['tag', 'v2', second])
    const checkoutDir = join(workdir, 'shared')
    const refs = ['v1', 'v2', 'v1', 'v2', 'v1', 'v2']
    const results = await Promise.all(refs.map(ref => resolveGitSource({ repo: pathToFileURL(repo).href, ref, paths: [], checkoutDir })))
    expect(results.map(result => result.commit)).toEqual(refs.map(ref => ref === 'v1' ? first : second))
  })

  it('rejects a source that is not a Git work tree', async () => {
    const plain = join(workdir, 'not-a-repo')
    await mkdir(plain, { recursive: true })
    await expect(resolveGitSource({ repo: plain, ref: 'master', paths: ['decisions/**'] }))
      .rejects.toThrow(/not a Git work tree/)
  })

  it('expands an owner/name shorthand into a clone URL and leaves URLs alone', () => {
    expect(cloneSource('my-org/garden-knowledge')).toBe('https://github.com/my-org/garden-knowledge.git')
    expect(cloneSource('https://example.com/x.git')).toBe('https://example.com/x.git')
    expect(cloneSource('git@example.com:x.git')).toBe('git@example.com:x.git')
  })
})

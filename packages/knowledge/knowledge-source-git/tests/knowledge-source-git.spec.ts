/**
 * Git knowledge source against disposable repositories: resolve a ref to a
 * commit, select the configured paths, and prove the recorded commit changes
 * when the source advances.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'
import { cloneSource, listSourceFiles, resolveGitSource } from '../src/index.ts'

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

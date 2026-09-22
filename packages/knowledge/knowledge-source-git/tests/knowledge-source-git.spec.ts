/**
 * Git knowledge source against disposable repositories: resolve a ref to a
 * commit, select the configured paths, and prove the recorded commit changes
 * when the source advances.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { cloneSource, listSourceFiles, resolveGitSource } from '../src/index.ts'

const run = promisify(execFile)

let workdir: string
let repo: string

/** Run one Git command in a disposable repository. */
async function gitIn(directory: string, args: string[]): Promise<string> {
  const { stdout } = await run('git', args, { cwd: directory })
  return stdout.trim()
}

/** Commit one file into a disposable repository. */
async function commitIn(directory: string, path: string, content: string, message: string): Promise<string> {
  const full = join(directory, path)
  await mkdir(join(full, '..'), { recursive: true })
  await writeFile(full, content, 'utf8')
  await gitIn(directory, ['add', path])
  await gitIn(directory, ['-c', 'user.email=test@example.com', '-c', 'user.name=Test', 'commit', '-m', message])
  return await gitIn(directory, ['rev-parse', 'HEAD'])
}

/** Run one Git command in the primary disposable repository. */
async function git(args: string[]): Promise<string> {
  return await gitIn(repo, args)
}

/** Commit one file into the primary disposable repository. */
async function commitFile(path: string, content: string, message: string): Promise<string> {
  return await commitIn(repo, path, content, message)
}

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'dsh-knowledge-git-'))
  repo = join(workdir, 'garden-knowledge')
  await mkdir(repo, { recursive: true })
  await git(['init', '-b', 'master'])
})

afterEach(async () => {
  // Git leaves pack and index files briefly mapped on Windows, so a concurrent
  // run can lose the race against teardown; retry rather than fail the spec.
  await rm(workdir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

describe('git knowledge source', () => {
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

  it('advances a managed clone to the fetched remote revision', async () => {
    const upstream = join(workdir, 'upstream')
    await mkdir(upstream, { recursive: true })
    await gitIn(upstream, ['init', '-b', 'master'])
    const first = await commitIn(upstream, 'knowledge/runbook.md', '# Runbook v1', 'runbook v1')

    const source = {
      repo: pathToFileURL(upstream).href,
      ref: 'master',
      paths: ['knowledge/**'],
      checkoutDir: join(workdir, 'checkout'),
    }
    const before = await resolveGitSource(source)
    expect(before.commit).toBe(first)

    // The upstream advances. A fetch moves origin/master; the clone's own
    // master branch stays where the clone left it.
    const second = await commitIn(upstream, 'knowledge/runbook.md', '# Runbook v2', 'runbook v2')
    const after = await resolveGitSource(source)

    expect(after.commit).toBe(second)
    expect(after.commit).not.toBe(before.commit)
    expect(await listSourceFiles(after, ['knowledge/**'])).toEqual(['knowledge/runbook.md'])
  })

  it('refuses to move a local checkout that has uncommitted tracked changes', async () => {
    const first = await commitFile('knowledge/runbook.md', '# Runbook v1', 'runbook v1')
    await commitFile('knowledge/runbook.md', '# Runbook v2', 'runbook v2')
    await git(['checkout', '--detach', first])
    await writeFile(join(repo, 'knowledge/runbook.md'), '# local edit', 'utf8')

    await expect(resolveGitSource({ repo, ref: 'master', paths: ['knowledge/**'] }))
      .rejects.toThrow(/uncommitted tracked changes/)

    // The rejected resolve left the operator's edit in place.
    expect(await readFile(join(repo, 'knowledge/runbook.md'), 'utf8')).toBe('# local edit')
    expect(await git(['rev-parse', 'HEAD'])).toBe(first)
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

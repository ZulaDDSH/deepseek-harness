/**
 * Git knowledge source against disposable repositories: resolve a ref to a
 * commit, select the configured paths, and prove the recorded commit changes
 * when the source advances.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { cloneSource, listSourceFiles, resolveGitSource } from '../src/index.ts'

const run = promisify(execFile)

let workdir: string
let repo: string

/** Run one Git command in the disposable repository. */
async function git(args: string[]): Promise<string> {
  const { stdout } = await run('git', args, { cwd: repo })
  return stdout.trim()
}

/** Commit one file into the disposable repository. */
async function commitFile(path: string, content: string, message: string): Promise<string> {
  const full = join(repo, path)
  await mkdir(join(full, '..'), { recursive: true })
  await writeFile(full, content, 'utf8')
  await git(['add', path])
  await git(['-c', 'user.email=test@example.com', '-c', 'user.name=Test', 'commit', '-m', message])
  return await git(['rev-parse', 'HEAD'])
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

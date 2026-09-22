/**
 * Git knowledge source: resolve a repository and ref into a local checkout the
 * knowledge service can ingest, and report the exact commit it resolved to.
 *
 * A public repository is cloned with ordinary Git semantics; a local checkout
 * is fetched in place. The resolved commit is the source record a knowledge
 * entry keeps, because the knowledge service itself records only a file path
 * and source type and cannot say which revision a document came from.
 *
 * @module @deepseek-ai/dsh-knowledge-source-git
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'

/** A knowledge source backed by a Git repository. */
export interface GitKnowledgeSource {
  /** Repository as `owner/name` on GitHub, or any URL/clone source Git accepts. */
  repo: string
  /** Branch, tag, or commit to check out. */
  ref: string
  /** Repository-relative paths to ingest; `**` matches any depth. */
  paths: readonly string[]
  /** Destination directory for a clone; ignored for a local checkout. */
  checkoutDir?: string
}

/** A resolved checkout with the commit it is pinned to. */
export interface ResolvedGitSource {
  /** Absolute path of the checkout the knowledge service indexes. */
  root: string
  /** Full commit SHA the checkout is pinned to. */
  commit: string
  /** Repository as configured. */
  repo: string
  /** Ref as configured. */
  ref: string
}

/** One finished Git command. */
interface GitResult {
  code: number
  stdout: string
  stderr: string
}

/**
 * Run one Git command with the subprocess seam's scrubbed environment.
 *
 * Credential-shaped ambient names are dropped, so a private repository reaches
 * Git only through host-side credential configuration (a credential helper or
 * an agent), never through a token this process holds.
 *
 * @param args - Git arguments, passed without shell interpolation.
 * @param cwd - Directory to run in.
 * @returns the exit code and captured streams.
 */
function git(args: readonly string[], cwd?: string): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', [...args], {
      cwd,
      env: scrubbedParentEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => { stdout += chunk })
    child.stderr.on('data', (chunk: string) => { stderr += chunk })
    child.on('error', reject)
    child.on('close', (code) => { resolve({ code: code ?? 1, stdout, stderr }) })
  })
}

/**
 * Run one Git command that must succeed.
 * @param args - Git arguments.
 * @param cwd - Directory to run in.
 * @returns trimmed stdout.
 */
async function gitOrThrow(args: readonly string[], cwd?: string): Promise<string> {
  const result = await git(args, cwd)
  if (result.code !== 0) {
    throw new Error(`git ${args[0] ?? ''} failed: ${result.stderr.trim() || `exit code ${result.code}`}`)
  }
  return result.stdout.trim()
}

/** Whether a directory is already a Git work tree. */
async function isWorkTree(root: string): Promise<boolean> {
  const result = await git(['rev-parse', '--is-inside-work-tree'], root)
  return result.code === 0 && result.stdout.trim() === 'true'
}

/** Whether the source names a local directory rather than a remote repository. */
function isLocalPath(repo: string): boolean {
  return repo.startsWith('/') || repo.startsWith('.') || /^[A-Za-z]:[\\/]/u.test(repo)
}

/**
 * Expand a `owner/name` shorthand into a clone URL, leaving anything else
 * (a URL, an absolute path, a `file://` source) untouched.
 * @param repo - configured repository.
 * @returns a source Git can clone.
 */
export function cloneSource(repo: string): string {
  if (isLocalPath(repo) || repo.includes('://') || repo.includes('@')) return repo
  return `https://github.com/${repo}.git`
}

/**
 * Resolve one configured ref to the commit this resolver checks out.
 *
 * A fetched remote-tracking revision outranks a same-named local branch: `fetch`
 * moves `refs/remotes/origin/<ref>` without moving the local branch, so checking
 * out the local name would pin the commit the clone held before the fetch and
 * report a source that never advances.
 *
 * @param root - checkout to resolve the ref in.
 * @param ref - configured branch, tag, or commit.
 * @returns the resolved full commit SHA.
 * @throws {Error} when no candidate revision resolves.
 */
async function resolveRefCommit(root: string, ref: string): Promise<string> {
  for (const candidate of [`refs/remotes/origin/${ref}`, `refs/tags/${ref}`, `refs/heads/${ref}`, ref]) {
    const result = await git(['rev-parse', '--verify', '--quiet', `${candidate}^{commit}`], root)
    if (result.code === 0 && result.stdout.trim() !== '') return result.stdout.trim()
  }
  throw new Error(`knowledge source ref ${JSON.stringify(ref)} does not resolve in ${root}`)
}

/**
 * Refuse to move a local checkout that carries uncommitted tracked changes.
 *
 * The checkout belongs to the operator, so a resolve that moves it must not
 * discard edits this package did not make. Untracked files are ignored because
 * no checkout replaces them.
 *
 * @param root - local work tree about to be moved.
 * @throws {Error} when tracked files differ from `HEAD`.
 */
async function assertCleanWorkTree(root: string): Promise<void> {
  const status = await gitOrThrow(['status', '--porcelain', '--untracked-files=no'], root)
  if (status !== '') {
    throw new Error(
      `knowledge source "${root}" has uncommitted tracked changes; `
      + 'commit or stash them, or configure a separate checkout, before resolving this ref',
    )
  }
}

/**
 * Resolve one Git knowledge source into a checkout pinned to a commit.
 *
 * A remote repository is cloned when absent and fetched when present, so a
 * repeated sync advances the checkout instead of re-downloading it. A local
 * checkout is used in place and fetched from its own remote when it has one.
 *
 * The resolved commit is checked out detached, so neither kind of checkout
 * leaves a branch checked out that a later resolve would silently reuse. A
 * local checkout that would move is refused while it carries uncommitted
 * tracked changes, and a checkout already standing at the resolved commit is
 * left exactly as it is.
 *
 * @param source - configured repository, ref, and paths.
 * @returns the checkout root and the commit it now resolves to.
 */
export async function resolveGitSource(source: GitKnowledgeSource): Promise<ResolvedGitSource> {
  const remote = cloneSource(source.repo)
  const local = isLocalPath(source.repo)
  let root: string
  if (local) {
    root = source.repo
    if (!await isWorkTree(root)) {
      throw new Error(`knowledge source "${source.repo}" is not a Git work tree`)
    }
    // A local checkout may have no remote; fetching is best effort.
    await git(['fetch', '--all', '--tags'], root)
  } else {
    root = source.checkoutDir ?? join(process.cwd(), '.dsh-knowledge', source.repo.replace(/[^A-Za-z0-9._-]/gu, '_'))
    if (existsSync(root) && await isWorkTree(root)) {
      await gitOrThrow(['fetch', '--all', '--tags'], root)
    } else {
      await mkdir(root, { recursive: true })
      await gitOrThrow(['clone', remote, root])
    }
  }

  const commit = await resolveRefCommit(root, source.ref)
  if (commit !== await gitOrThrow(['rev-parse', 'HEAD'], root)) {
    if (local) await assertCleanWorkTree(root)
    await gitOrThrow(['checkout', '--detach', commit], root)
  }
  return { root, commit, repo: source.repo, ref: source.ref }
}

/**
 * List the repository-relative files one source's `paths` select.
 *
 * The result is what the knowledge service should be told to ingest; matching
 * uses Git's own pathspec rules so `**` spans directories as configured.
 *
 * @param resolved - a checkout returned by {@link resolveGitSource}.
 * @param paths - repository-relative pathspecs.
 * @returns tracked file paths under those pathspecs, repository-relative.
 */
export async function listSourceFiles(
  resolved: ResolvedGitSource,
  paths: readonly string[],
): Promise<string[]> {
  const args = ['ls-files', '--cached', '--', ...paths]
  const stdout = await gitOrThrow(args, resolved.root)
  return stdout.split('\n').map(line => line.trim()).filter(line => line.length > 0)
}

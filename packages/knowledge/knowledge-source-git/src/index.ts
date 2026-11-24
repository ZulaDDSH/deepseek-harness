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

import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join, resolve as resolvePath } from 'node:path'
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

export interface GitOperationOptions {
  signal?: AbortSignal
  timeoutMs?: number
  maxOutputBytes?: number
}

interface GitRun {
  signal: AbortSignal
  maxOutputBytes: number
}

const DEFAULT_TIMEOUT_MS = 30 * 60_000
const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024 * 1024

function gitRun(options: GitOperationOptions = {}): GitRun {
  const deadline = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  return {
    signal: options.signal === undefined ? deadline : AbortSignal.any([options.signal, deadline]),
    maxOutputBytes: options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
  }
}

function killTree(child: ChildProcess): void {
  if (child.pid === undefined) {
    child.kill()
  } else if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }).on('error', () => { child.kill() })
  } else {
    try { process.kill(-child.pid, 'SIGKILL') } catch { child.kill('SIGKILL') }
  }
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
function git(args: readonly string[], cwd: string | undefined, run: GitRun): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    if (run.signal.aborted) {
      reject(abortReason(run.signal, args))
      return
    }
    const child = spawn('git', [...args], {
      cwd,
      env: scrubbedParentEnv({ proxyCredentials: true }),
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    })
    let stdout = ''
    let stderr = ''
    let bytes = 0
    let errBytes = 0
    const settle = (fail: Error): void => {
      run.signal.removeEventListener('abort', onAbort)
      killTree(child)
      child.stdout?.destroy()
      child.stderr?.destroy()
      reject(fail)
    }
    const onAbort = (): void => { settle(abortReason(run.signal, args)) }
    run.signal.addEventListener('abort', onAbort, { once: true })
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      bytes += Buffer.byteLength(chunk)
      if (bytes > run.maxOutputBytes) settle(new Error(`git ${args[0]} produced more than ${run.maxOutputBytes} bytes of output`))
      else stdout += chunk
    })
    child.stderr.on('data', (chunk: string) => {
      errBytes += Buffer.byteLength(chunk)
      if (errBytes > run.maxOutputBytes) settle(new Error(`git ${args[0]} produced more than ${run.maxOutputBytes} bytes of error output`))
      else stderr += chunk
    })
    child.on('error', (error) => {
      run.signal.removeEventListener('abort', onAbort)
      reject(error)
    })
    child.on('close', (code) => {
      run.signal.removeEventListener('abort', onAbort)
      resolve({ code: code ?? 1, stdout, stderr })
    })
  })
}

function abortReason(signal: AbortSignal, args: readonly string[]): Error {
  const reason: unknown = signal.reason
  if (reason instanceof DOMException && reason.name === 'TimeoutError') return new Error(`git ${args[0]} timed out`)
  return reason instanceof Error ? reason : new Error(`git ${args[0]} was cancelled`)
}

/**
 * Run one Git command that must succeed.
 * @param args - Git arguments.
 * @param cwd - Directory to run in.
 * @returns trimmed stdout.
 */
async function gitOrThrow(args: readonly [string, ...string[]], cwd: string | undefined, run: GitRun): Promise<string> {
  const result = await git(args, cwd, run)
  if (result.code !== 0) {
    throw new Error(`git ${args[0]} failed: ${result.stderr.trim() || `exit code ${result.code}`}`)
  }
  return result.stdout.trim()
}

/** Whether a directory is already a Git work tree. */
async function isWorkTree(root: string, run: GitRun): Promise<boolean> {
  const result = await git(['rev-parse', '--is-inside-work-tree'], root, run)
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
 * Resolve one Git knowledge source into a checkout pinned to a commit.
 *
 * A remote repository is cloned when absent and fetched when present, so a
 * repeated sync advances the checkout instead of re-downloading it. A local
 * checkout is used in place and fetched from its own remote when it has one.
 *
 * @param source - configured repository, ref, and paths.
 * @returns the checkout root and the commit it now resolves to.
 */
export async function resolveGitSource(
  source: GitKnowledgeSource,
  options?: GitOperationOptions,
): Promise<ResolvedGitSource> {
  const remote = cloneSource(source.repo)
  const root = resolvePath(isLocalPath(source.repo)
    ? source.repo
    : source.checkoutDir ?? join(process.cwd(), '.dsh-knowledge', createHash('sha256').update(remote).digest('hex')))
  return serialized(root, () => resolveLocked(source, remote, root, gitRun(options)))
}

const chains = new Map<string, Promise<unknown>>()

function serialized<T>(root: string, task: () => Promise<T>): Promise<T> {
  const key = process.platform === 'win32' ? root.toLowerCase() : root
  const next = (chains.get(key) ?? Promise.resolve()).then(task, task)
  const tail = next.catch(() => undefined)
  chains.set(key, tail)
  void tail.then(() => { if (chains.get(key) === tail) chains.delete(key) })
  return next
}

async function resolveLocked(source: GitKnowledgeSource, remote: string, root: string, run: GitRun): Promise<ResolvedGitSource> {
  const local = isLocalPath(source.repo)
  if (local) {
    if (!await isWorkTree(root, run)) {
      throw new Error(`knowledge source "${source.repo}" is not a Git work tree`)
    }
    if (await gitOrThrow(['status', '--porcelain', '--untracked-files=no'], root, run) !== '') {
      throw new Error(`knowledge source "${source.repo}" has uncommitted changes to tracked files; commit or stash them first`)
    }
    if (await gitOrThrow(['remote'], root, run) !== '') await gitOrThrow(['fetch', '--all', '--tags'], root, run)
  } else {
    await mkdir(root, { recursive: true })
    if (await isWorkTree(root, run) && await gitOrThrow(['rev-parse', '--show-prefix'], root, run) === '') {
      const origin = await gitOrThrow(['config', '--get', 'remote.origin.url'], root, run)
      if (origin !== remote) throw new Error(`knowledge checkout "${root}" has a different origin from "${source.repo}"`)
      await gitOrThrow(['fetch', '--all', '--tags'], root, run)
    } else {
      await gitOrThrow(['clone', '--no-checkout', remote, root], undefined, run)
    }
  }

  const branch = source.ref.replace(/^refs\/heads\//u, '')
  const tag = await git(['rev-parse', '--verify', '--end-of-options', `refs/tags/${source.ref}^{commit}`], root, run)
  const fetched = await git(['rev-parse', '--verify', '--end-of-options', `refs/remotes/origin/${branch}^{commit}`], root, run)
  const pinned = /^(?:[a-f\d]{40}|[a-f\d]{64})$/iu.test(source.ref)
    || source.ref.startsWith('refs/') && !source.ref.startsWith('refs/heads/')
    || source.ref.startsWith('origin/')
  const ref = pinned ? source.ref : tag.code === 0 ? tag.stdout.trim() : fetched.code === 0 ? fetched.stdout.trim() : source.ref
  const commitRef = await gitOrThrow(['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`], root, run)
  const localBranch = local && !pinned && tag.code !== 0 && fetched.code !== 0
  if (!local || await gitOrThrow(['rev-parse', 'HEAD'], root, run) !== commitRef) {
    await gitOrThrow(['checkout', ...local ? [] : ['--force'], ...localBranch ? [] : ['--detach'], localBranch ? source.ref : `${commitRef}^{commit}`], root, run)
  }
  const commit = await gitOrThrow(['rev-parse', 'HEAD'], root, run)
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
  options?: GitOperationOptions,
): Promise<string[]> {
  return serialized(resolvePath(resolved.root), async () => {
    const run = gitRun(options)
    const result = await git(['ls-files', '-z', '--cached', '--', ...paths], resolved.root, run)
    if (result.code !== 0) throw new Error(`git ls-files failed: ${result.stderr.trim() || `exit code ${result.code}`}`)
    const head = await gitOrThrow(['rev-parse', 'HEAD'], resolved.root, run)
    if (head !== resolved.commit) {
      throw new Error(`knowledge checkout "${resolved.root}" moved to ${head} after it was resolved at ${resolved.commit}; resolve it again`)
    }
    return result.stdout.split('\0').filter(path => path.length > 0)
  })
}

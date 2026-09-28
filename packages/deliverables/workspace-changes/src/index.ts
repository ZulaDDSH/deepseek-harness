/**
 * Summarizes the files each top-level turn changed from git working-tree
 * snapshots taken at turn start and turn end, plus whole-file captures taken
 * around each file-tool edit for paths git does not cover, and serves each
 * listed file's before-and-after comparison on demand. Each summary is
 * announced by a `workspace/changes` Session event that carries only the turn
 * number; summaries and comparisons are served through the `workspaceChanges`
 * service until the Session is disposed. Outside a git repository, or without
 * git, the summary lists file-tool edits only.
 */
import { homedir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type {} from '@deepseek-ai/dsh-agent'
import type { Session, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-workspace'
import { GitRunner, locateGitWorkspace, resolveRepositoryRoot } from './git.ts'
import { diffOfRecord, servedRecordOf, TurnRecorder, type Repository } from './recorder.ts'
import { readWorkspaceDiff, readWorkspaceStatus } from './status.ts'
import { canonicalPath } from './paths.ts'
import { pruneRoot, readRecord, sessionDirectory, type RetentionPolicy } from './store.ts'
import type { WorkspaceChanges } from './types.ts'

export type {
  WorkspaceChangedFile, WorkspaceChanges, WorkspaceChangesSummary, WorkspaceDiffHunk,
  WorkspaceFileDiff, WorkspaceStatus, WorkspaceStatusFile,
} from './types.ts'

/** Stable Loader identity. */
export const name = 'workspace-changes'

/** Services used to run git and observe turns. */
export const inject = ['subprocess']

/** Snapshot, capture, and comparison bounds. Invalid values fail plugin load. */
export interface Config {
  /** Milliseconds one git command may run before the turn's record is abandoned. */
  timeoutMs: number
  /** Bytes of git output retained per command; a larger diff listing abandons the record. */
  outputMaxBytes: number
  /** Maximum files carried by one summary; `total` still reports the complete count. */
  maxFiles: number
  /**
   * Bytes a file may hold to be captured around a file-tool edit or read from a snapshot for its comparison.
   * A larger file gets no comparison; one captured around a file-tool edit is also listed without counts.
   */
  maxFileBytes: number
  /** Milliseconds a line comparison may run before it degrades to whole-file replacement. */
  diffTimeoutMs: number
  /**
   * Durable root holding each Session's records, captured copies, and snapshot
   * objects. Records outlive their Session, so this directory is what a later
   * Host process serves earlier turns from.
   */
  root: string
  /** Sessions whose records are kept, newest first; older ones are pruned. */
  retentionSessions: number
  /** Bytes kept across the root; the oldest records beyond it are pruned. */
  retentionBytes: number
  /** Days a Session's records are kept; an older directory is pruned. */
  retentionDays: number
}

/** Schemastery validation for {@link Config}. */
export const Config: z<Config> = z.object({
  timeoutMs: z.number().default(30_000),
  outputMaxBytes: z.number().default(8 * 1024 * 1024),
  maxFiles: z.number().default(500),
  maxFileBytes: z.number().default(2 * 1024 * 1024),
  diffTimeoutMs: z.number().default(100),
  root: z.string().default(dshHomePath('workspace-changes')),
  retentionSessions: z.number().step(1).min(1).default(200),
  retentionBytes: z.number().step(1).min(1).default(512 * 1024 * 1024),
  retentionDays: z.number().min(0).default(30),
})

function eligible(session: Session): string | undefined {
  const { cwd, origin, delegationDepth } = session.header
  return origin === 'subagent' || (delegationDepth ?? 0) > 0 ? undefined : cwd
}

/**
 * Resolve the git executable once. On macOS the Xcode stub at `/usr/bin/git`
 * opens an installer dialog instead of running, so it counts as absent until
 * developer tools are selected.
 * @param ctx - subprocess capability.
 * @param signal - plugin lifetime.
 * @returns the executable path, or null when git is unavailable.
 */
async function resolveGit(ctx: Context, signal: AbortSignal): Promise<string | null> {
  let executable: string
  try {
    executable = await ctx.subprocess.resolveExecutable('git', undefined, signal)
  } catch {
    return null
  }
  if (process.platform !== 'darwin' || executable !== '/usr/bin/git') return executable
  const probe = ctx.subprocess.spawn({
    argv: ['/usr/bin/xcode-select', '-p'], cwd: homedir(),
    stdio: { stdin: 'ignore', stdout: { maxBytes: 4096 }, stderr: { maxBytes: 4096 } }, graceMs: 1_000, signal,
  })
  const outcome = await probe.done.catch(() => ({ exitCode: null }))
  return outcome.exitCode === 0 ? executable : null
}

/**
 * Observe top-level turns of every Session with a working directory, capture
 * file-tool edits, announce change summaries, and serve them with their
 * comparisons as `workspaceChanges`.
 * @param ctx - host context with `subprocess`.
 * @param config - validated bounds.
 */
export function apply(ctx: Context, config: Config): void {
  for (const [field, value] of [
    ['timeoutMs', config.timeoutMs], ['outputMaxBytes', config.outputMaxBytes], ['maxFiles', config.maxFiles],
    ['maxFileBytes', config.maxFileBytes], ['diffTimeoutMs', config.diffTimeoutMs],
    ['retentionSessions', config.retentionSessions], ['retentionBytes', config.retentionBytes],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`workspace-changes requires a positive integer ${field}`)
  }
  if (!Number.isFinite(config.retentionDays) || config.retentionDays < 0) {
    throw new Error('workspace-changes requires a non-negative retentionDays')
  }
  if (config.root.trim() === '') throw new Error('workspace-changes requires a non-empty root')
  const retention: RetentionPolicy = {
    maxSessions: config.retentionSessions,
    maxBytes: config.retentionBytes,
    maxAgeMs: config.retentionDays * 24 * 60 * 60 * 1000,
  }
  const lifetime = new AbortController()
  const recorders = new Map<Session, TurnRecorder>()
  const byId = new Map<SessionId, TurnRecorder>()
  /** Repositories rediscovered for Sessions this process did not record, by Session id. */
  const repositories = new Map<SessionId, Promise<Repository | null>>()
  const forget = (session: Session): Promise<void> => {
    const recorder = recorders.get(session)
    recorders.delete(session)
    byId.delete(session.id)
    return recorder?.dispose() ?? Promise.resolve()
  }
  ctx.effect(() => async () => {
    lifetime.abort()
    await Promise.all([...recorders.keys()].map(forget))
  })
  /** Apply retention without letting a pruning failure disturb the turn that triggered it. */
  const prune = (): void => {
    void pruneRoot(config.root, retention, Date.now()).catch((error: unknown) => {
      ctx.logger.warn(`workspace-changes: retention pruning failed: ${String(error)}`)
    })
  }
  /**
   * The repository enclosing a Session this process did not record. Snapshot
   * sides resolve against the Session's own durable directory, which still
   * holds the objects the record's trees name.
   */
  const repositoryFor = (sessionId: SessionId, cwd: string, directory: string, signal: AbortSignal): Promise<Repository | null> => {
    let found = repositories.get(sessionId)
    if (found === undefined) {
      found = (async (): Promise<Repository | null> => {
        const git = await gitRunner()
        if (git === null) return null
        const workspace = await locateGitWorkspace(git, cwd, () => Promise.resolve(directory), signal)
        return workspace === null ? null : { git, workspace }
      })()
      repositories.set(sessionId, found)
    }
    return found
  }
  // The registry is an optional service whose provider may still be initializing
  // while this plugin applies, so read it per request instead of capturing it.
  const service: WorkspaceChanges = {
    summary: async (sessionId, seq) => {
      const live = byId.get(sessionId)?.summary(seq)
      if (live !== undefined) return live
      return (await readRecord(sessionDirectory(config.root, sessionId), seq))?.summary
    },
    diff: async (sessionId, seq, index, signal) => {
      const live = byId.get(sessionId)
      if (live !== undefined) return live.diff(seq, index, signal)
      const directory = sessionDirectory(config.root, sessionId)
      const stored = await readRecord(directory, seq)
      if (stored === undefined) return undefined
      const repository = await repositoryFor(sessionId, stored.summary.cwd, directory, signal)
      const served = servedRecordOf(stored, directory, repository)
      return served === undefined ? undefined : diffOfRecord(served, index, config, signal)
    },
    status: async (workspaceId, signal) => {
      const registered = ctx.get('workspaceRegistry')?.get(workspaceId)
      if (registered === undefined) return undefined
      const git = await gitRunner()
      if (git === null) return undefined
      const root = await resolveRepositoryRoot(git, registered.path, signal)
      return root === null
        ? undefined
        : readWorkspaceStatus(git, root, await canonicalPath(registered.path), config.maxFiles, signal)
    },
    workspaceDiff: async (workspaceId, index, signal) => {
      const registered = ctx.get('workspaceRegistry')?.get(workspaceId)
      if (registered === undefined) return undefined
      const git = await gitRunner()
      if (git === null) return undefined
      const root = await resolveRepositoryRoot(git, registered.path, signal)
      if (root === null) return undefined
      const status = await readWorkspaceStatus(git, root, await canonicalPath(registered.path), config.maxFiles, signal)
      const file = status.files[index]
      return file === undefined ? undefined : readWorkspaceDiff(git, root, file, config.maxFileBytes, config.diffTimeoutMs, signal)
    },
  }
  ctx.provide('workspaceChanges', service)
  // Bound the root once at load, so a Host that restarted into an oversized
  // directory prunes it without waiting for the next completed turn.
  prune()
  let runner: Promise<GitRunner | null> | undefined
  const gitRunner = (): Promise<GitRunner | null> => {
    runner ??= resolveGit(ctx, lifetime.signal).then((executable) => {
      if (executable === null) {
        ctx.logger.info('workspace-changes: git is unavailable; only file-tool edits are summarized')
        return null
      }
      return new GitRunner(ctx.subprocess, executable, { timeoutMs: config.timeoutMs, outputMaxBytes: config.outputMaxBytes })
    })
    return runner
  }
  const recorderFor = (session: Session, cwd: string): TurnRecorder => {
    let recorder = recorders.get(session)
    if (recorder === undefined) {
      recorder = new TurnRecorder(session, cwd, {
        git: gitRunner(), maxFiles: config.maxFiles,
        maxFileBytes: config.maxFileBytes, diffTimeoutMs: config.diffTimeoutMs,
        warn: (message) => { ctx.logger.warn(message) },
      }, sessionDirectory(config.root, session.id))
      recorders.set(session, recorder)
      byId.set(session.id, recorder)
    }
    return recorder
  }
  ctx.on('session/event', (session, event) => {
    if (event.type === 'turn/start') {
      const cwd = eligible(session)
      if (cwd !== undefined) recorderFor(session, cwd).start(event.data.turn)
      return
    }
    if (event.type === 'tool/result') recorders.get(session)?.observe(event)
    else if (event.type === 'turn/end') {
      recorders.get(session)?.end(event.data.turn)
      // A completed turn is the natural, low-frequency point to bound the root.
      prune()
    }
  })
  ctx.on('session/disposed', (session) => { void forget(session) })
  ctx.on('agent/turn-stopping', async ({ agent, turn }) => {
    await recorders.get(agent.session)?.stopping(turn)
  })
  ctx.on('tools/pre-execute', async (exec, next) => {
    const session = exec.agent?.session
    const recorder = session === undefined ? undefined : recorders.get(session)
    if (recorder !== undefined) {
      recorder.capture(exec.name, exec.arguments)
      await recorder.settled()
    }
    return next()
  })
}

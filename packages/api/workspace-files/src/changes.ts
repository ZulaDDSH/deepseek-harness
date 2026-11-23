/**
 * Target-scoped filesystem watches and `fs/observed` invalidations for `changes`.
 * Each generation sends `ready` after watcher initialization, then reads current
 * target metadata for matching queued and live invalidations.
 */

import type { Context } from '@deepseek-ai/cordis'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { FsTarget } from '@deepseek-ai/dsh-fs'
import type { WorkspaceFileWatchFrame } from './types.ts'

const PRE_TARGET_LIMIT = 1024

/** Owns target watches, instrumented observations, and every open `changes` generation. */
export class WorkspaceChangeFeed {
  private readonly followers = new Set<ChangeFollower>()

  /** @param ctx - Host context carrying the filesystem the observations come from. */
  constructor(private readonly ctx: Context) {
    ctx.on('fs/observed', (target) => {
      for (const follower of this.followers) follower.push(target)
    })
    ctx.effect(() => async () => {
      const followers = [...this.followers]
      await Promise.all(followers.map(follower => follower.close()))
      this.followers.clear()
    }, 'workspace-files.changes')
  }

  /**
   * Open one target watch; directory targets remain inside `workspaceRoot`.
   * @param workspaceRoot - the session's workspace root path.
   * @param path - target path, resolved relative to the workspace root; Host metadata determines its type.
   * @param signal - generation cancellation.
   * @returns `ready` after watching starts, then current metadata for target invalidations.
   */
  async *follow(
    workspaceRoot: string, path: string, signal: AbortSignal, confineFiles = false,
  ): AsyncIterable<WorkspaceFileWatchFrame> {
    signal.throwIfAborted()
    // Instrumented observations remain queued while the target resolves.
    const follower = new ChangeFollower(() => {
      signal.removeEventListener('abort', cancel)
      this.followers.delete(follower)
    })
    signal = AbortSignal.any([signal, follower.controller.signal])
    const aborted = (): boolean => signal.aborted
    const cancel = (): void => {
      void follower.close().catch((error: unknown) => { this.ctx.logger.error(error) })
    }
    signal.addEventListener('abort', cancel, { once: true })
    this.followers.add(follower)
    let unwatch: (() => Promise<void>) | undefined
    try {
      // Setup shares cancellation, so a late resolution cannot acquire a watcher.
      const root = await this.ctx.fs.resolve(workspaceRoot, { signal }).catch((error: unknown) => {
        if (aborted()) return undefined
        throw error
      })
      if (root === undefined || aborted() || follower.isClosed) return
      const target = await this.ctx.fs.resolve(path, { cwd: workspaceRoot, signal }).catch((error: unknown) => {
        if (aborted()) return undefined
        throw error
      })
      if (target === undefined || aborted()) return
      follower.track(target.targetKey)
      const stat = async () => {
        const info = await this.ctx.fs.stat(target, signal).catch((error: unknown) => {
          if (aborted()) return undefined
          throw error
        })
        if ((confineFiles || info?.type === 'directory') && !this.ctx.fs.contains(root, target)) {
          throw new RemoteError('workspace-file/outside-workspace', 'Directory is outside the workspace', { path })
        }
        return info
      }
      await stat()
      if (aborted()) return
      try {
        unwatch = await this.ctx.fs.watch(target, (error) => {
          if (error !== undefined) follower.fail(error)
          else if (!follower.isClosed) follower.push(target)
        }, signal)
        if (follower.error !== undefined) throw follower.error
      } catch (error) {
        if (aborted() && follower.error === undefined) return
        const failure = follower.error ?? error
        throw new RemoteError('workspace-file/watch-unsupported',
          failure instanceof Error ? failure.message : String(failure), { path })
      }
      follower.initialized.resolve(unwatch)
      if (aborted()) return
      yield { kind: 'ready' }
      for await (const _invalidated of follower.read()) {
        const info = await stat()
        if (aborted()) return
        const absolutePath = this.ctx.fs.processPath(target)
        yield {
          kind: 'change',
          change: info !== undefined
            ? { absolutePath, version: info.version }
            : { absolutePath, absent: true },
        }
      }
    } finally {
      follower.initialized.resolve(unwatch)
      await follower.close()
    }
  }
}

class ChangeFollower {
  readonly controller = new AbortController()
  readonly initialized = Promise.withResolvers<(() => Promise<void>) | undefined>()
  error: Error | undefined
  private readonly early = new Set<string>()
  private earlyOverflow = false
  private targetKey: string | undefined
  private dirty = false
  private wake: (() => void) | undefined
  private closed = false
  private closing: Promise<void> | undefined

  constructor(private readonly release: () => void) {}

  /** Whether this generation has stopped accepting invalidations. */
  get isClosed(): boolean {
    return this.closed
  }

  push(observed: FsTarget): void {
    if (this.closed) return
    if (this.targetKey === undefined) {
      if (this.early.size < PRE_TARGET_LIMIT) this.early.add(observed.targetKey)
      else this.earlyOverflow = true
      return
    }
    if (observed.targetKey !== this.targetKey) return
    this.dirty = true
    this.wake?.()
  }

  track(targetKey: string): void {
    this.targetKey = targetKey
    this.dirty = this.earlyOverflow || this.early.has(targetKey)
    this.early.clear()
    this.earlyOverflow = false
  }

  close(): Promise<void> {
    if (this.closing !== undefined) return this.closing
    this.closed = true
    this.closing = this.initialized.promise.then(unwatch => unwatch?.()).finally(this.release)
    this.controller.abort()
    this.wake?.()
    return this.closing
  }

  fail(error: Error): void {
    this.error = error
    this.controller.abort()
  }

  async *read(): AsyncIterable<void> {
    while (!this.closed) {
      if (this.dirty) {
        this.dirty = false
        yield
        continue
      }
      await new Promise<void>((resolve) => { this.wake = resolve })
      this.wake = undefined
    }
    if (this.error !== undefined) throw this.error
  }
}

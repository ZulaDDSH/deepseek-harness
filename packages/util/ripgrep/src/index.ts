/** Packaged ripgrep resolution and subprocess execution, independent of tool or Remote consumers. */
import { existsSync } from 'node:fs'
import { join, parse } from 'node:path'
import type { SubprocessHandle, SubprocessOutcome, SubprocessRuntime, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'

let rgPathPromise: Promise<string> | undefined

/**
 * Resolve the packaged executable lazily, once per process. Single-file runtimes use an existing
 * `-rg` sidecar; Electron uses the unpacked ASAR path. Resolution failures reject
 * this call, not package loading. No system executable or remote fallback is used.
 * @returns the packaged executable's absolute path.
 */
export function resolveRgPath(): Promise<string> {
  rgPathPromise ??= Promise.resolve().then(async () => {
    const executable = parse(process.execPath)
    const executableSidecar = process.platform === 'win32'
      ? join(executable.dir, `${executable.name}-rg.exe`)
      : `${process.execPath}-rg`
    if ('pkg' in process && existsSync(executableSidecar)) return executableSidecar
    const dependency = (await import('@vscode/ripgrep')).rgPath
    return process.versions.electron === undefined
      ? dependency
      : dependency.replace(/\.asar(?=[\\/])/u, '.asar.unpacked')
  })
  return rgPathPromise
}

/**
 * Start packaged ripgrep with explicit subprocess settings. `spec.argv` contains
 * only rg arguments, without an executable. This function prepends the resolved
 * rg executable path and `--no-config`, so ambient configuration cannot enable a
 * preprocessor. The caller owns exit classification and process cleanup.
 * @param subprocess - the composed subprocess service.
 * @param spec - cwd, rg arguments (without the executable), stdio, signal and termination grace.
 * @returns the live subprocess handle; resolution and synchronous spawn failures reject.
 */
export async function spawnRipgrep(subprocess: Pick<SubprocessRuntime, 'spawn'>, spec: SubprocessSpawnSpec): Promise<SubprocessHandle> {
  const executable = await resolveRgPath()
  return subprocess.spawn({ ...spec, argv: [executable, '--no-config', ...spec.argv] })
}

/** Exit facts and whether the line consumer requested early termination. */
export interface RipgrepLinesResult {
  readonly outcome: SubprocessOutcome
  readonly stopped: boolean
  readonly undecodable?: number
}

/**
 * Read UTF-8 stdout records without retaining the complete output. A false
 * callback return terminates the process and suppresses remaining records.
 * Completion, callback failure and stream failure all await process quiescence;
 * provider failures reject. Exit codes and cancellation remain consumer-owned.
 * @param handle - an owned ripgrep process spawned with piped stdout.
 * A record that is not valid UTF-8 is delivered with U+FFFD replacements and
 * counted in the result's `undecodable`.
 * @param separator - newline for text output, or NUL for file paths that may contain newlines.
 * @param onLine - synchronous record consumer; false requests early termination.
 * @returns exit facts after stdout and the managed process range settle.
 */
export async function readRipgrepLines(
  handle: SubprocessHandle,
  separator: '\n' | '\0',
  onLine: (line: string) => boolean,
): Promise<RipgrepLinesResult> {
  const stdout = handle.stdout
  if (stdout === undefined) {
    handle.terminate()
    await Promise.allSettled([handle.done, handle.waitForExit()])
    throw new Error('ripgrep requires piped stdout')
  }
  let stopped = false
  let completed = false
  let undecodable = 0
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
  const separatorByte = separator.charCodeAt(0)
  const decode = (record: Buffer): string => {
    try { return decoder.decode(record) } catch {
      undecodable += 1
      return record.toString('utf8')
    }
  }
  const reading = (async () => {
    let pending: Buffer = Buffer.alloc(0)
    for await (const chunk of stdout as AsyncIterable<Buffer | string>) {
      if (stopped) continue
      pending = Buffer.concat([pending, typeof chunk === 'string' ? Buffer.from(chunk) : chunk])
      let end: number
      while ((end = pending.indexOf(separatorByte)) !== -1) {
        const line = decode(pending.subarray(0, end))
        pending = pending.subarray(end + 1)
        if (!onLine(line)) {
          stopped = true
          pending = Buffer.alloc(0)
          handle.terminate()
          break
        }
      }
    }
    if (pending.length > 0 && !onLine(decode(pending))) {
      stopped = true
      handle.terminate()
    }
  })()
  try {
    const [, outcome] = await Promise.all([reading, handle.done])
    completed = true
    return { outcome, stopped, ...undecodable > 0 ? { undecodable } : {} }
  } finally {
    if (!completed) {
      handle.terminate()
      stdout.destroy()
    }
    await Promise.allSettled([reading, handle.done])
    await handle.waitForExit()
  }
}

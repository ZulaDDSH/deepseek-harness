import { readFileSync } from 'node:fs'
import SubprocessRuntime from '@deepseek-ai/dsh-subprocess'
import type { SubprocessHandle, SubprocessOutcome, SubprocessOutputReader, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'

/** A subprocess service that records spawn specs and each `-File` script's bytes, and settles instantly. */
export class CapturingSubprocessRuntime extends SubprocessRuntime {
  async terminalEnvironment() { return { platform: 'posix' as const } }
  specs: SubprocessSpawnSpec[] = []
  scripts: Buffer[] = []
  done: Promise<SubprocessOutcome> = Promise.resolve({ exitCode: 0, signal: null })
  stderrText = ''
  override async resolveExecutable(command: string): Promise<string> { return command }
  override spawnTerminal(): Promise<never> { throw new Error('pwsh spawns pipes, never terminals') }
  private readonly stdoutReader: SubprocessOutputReader = {
    readFrom: () => ({ text: '', lossy: false, nextOffset: 0 }),
  }
  private readonly stderrReader: SubprocessOutputReader = {
    readFrom: offset => ({
      text: this.stderrText.slice(offset),
      lossy: false,
      nextOffset: this.stderrText.length,
    }),
  }
  override spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    this.specs.push(spec)
    if (spec.argv.includes('-File')) this.scripts.push(readFileSync(spec.argv.at(-1)!))
    return {
      control: undefined,
      stdin: undefined,
      stdout: undefined,
      stderr: undefined,
      collected: { stdout: this.stdoutReader, stderr: this.stderrReader },
      done: this.done,
      terminate: () => {},
      waitForExit: async () => true,
    }
  }
}

import type { CliTerminalProjection, TurnBoundaryProjection } from './types.ts'
import type {} from '@deepseek-ai/dsh-session-projection'

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** The agent session's open/last turn and step boundary facts (whole value). */
    turnBoundary: TurnBoundaryProjection
    /** The CLI terminal profile the session hosts, or null for an ordinary session. */
    cliTerminal: CliTerminalProjection
  }
}

export {}

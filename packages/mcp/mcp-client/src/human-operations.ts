import type { Context } from '@deepseek-ai/cordis'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { scopeOf } from '@deepseek-ai/dsh-scope'


export interface McpHumanOperations {

  readonly local: boolean

  readonly cwd: string

  readonly env: Readonly<Record<string, string>>

  call(name: string, args: Record<string, JsonValue>, signal: AbortSignal): Promise<unknown>
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    'mcp/human-operations'(server: string, next: () => Promise<McpHumanOperations | undefined>): Promise<McpHumanOperations | undefined>
  }
}


export function registerHumanOperations(ctx: Context, server: string, operations: McpHumanOperations): void {
  if (scopeOf(ctx) !== undefined) return
  ctx.on('mcp/human-operations', async (requested, next) => requested === server ? operations : next())
}

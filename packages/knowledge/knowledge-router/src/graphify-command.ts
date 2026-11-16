/** @module Human chat commands invoking the installed Graphify CLI. */
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { runNativeCommand, type NativeCommandRunner } from '@deepseek-ai/dsh-native-command'
import type {} from '@deepseek-ai/dsh-commands'

/** Executable and optional launcher arguments for Graphify. */
export interface GraphifyCommandConfig {
  /** Executable path or PATH name. */
  command: string
  /** Arguments preceding the Graphify subcommand. */
  args: string[]
}

/**
 * Register workspace-scoped Graphify commands without a shell.
 * @param ctx - owner with the human-command registry.
 * @param config - installed Graphify launcher.
 * @param runner - cancellable native process runner.
 */
export function registerGraphifyCommand(ctx: Context, config: GraphifyCommandConfig,
  runner: NativeCommandRunner = runNativeCommand): void {
  ctx.effect(() => ctx.commands.register({
    name: 'graphify', description: 'Invoke Graphify in this chat workspace',
    input: { hint: 'update | query "question" | explain "node" | path "source" "target" | export html' },
    handler: async (invocation) => {
      const cwd = invocation.agent.session.header.cwd
      if (cwd === undefined) return { kind: 'error', text: 'Graphify requires a chat workspace' }
      const input = invocation.rawInput.trim()
      const tokens = input.match(/"(?:\\.|[^"\\])*"|'[^']*'|[^\s"']+/g) ?? []
      if (tokens.join(' ').replace(/\s/g, '') !== input.replace(/\s/g, '')) return { kind: 'error', text: 'Graphify arguments contain an unmatched quote' }
      const args = tokens.map(token => token.startsWith('"') ? String(JSON.parse(token))
        : token.startsWith("'") ? token.slice(1, -1) : token)
      const command = args.shift() ?? 'update'
      const graph = join(cwd, 'graphify-out', 'graph.json')
      const run = (argv: string[]) => runner(config.command, [...config.args, ...argv], invocation.signal, 'hidden')
      if (command === 'update' && args.length === 0) {
        await run(['update', cwd, '--no-cluster'])
        await run(['cluster-only', cwd, '--graph', graph, '--no-label', '--no-viz'])
        const result = await run(['export', 'html', '--graph', graph])
        return { kind: 'success', text: result.stdout }
      }
      const valid = (command === 'query' || command === 'explain') ? args.length === 1
        : command === 'path' ? args.length === 2 : command === 'export' && args.length === 1 && args[0] === 'html'
      if (!valid) return { kind: 'error', text: 'Use /graphify update, query "question", explain "node", path "source" "target", or export html' }
      const result = await run([command, ...args, '--graph', graph])
      return { kind: 'success', text: result.stdout }
    },
  }), 'graphify: command')
}

/**
 * The globally named `list_agents` tool: a thin model-facing adapter over
 * the continuable projection of `ctx.subagents.listChildren()` and, for the
 * `descendants` scope, `ctx.subagents.listDescendants()`. The control plugin owns
 * registration and disposal alongside messaging and interruption.
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type {
  SubagentCatalogEntry, SubagentDescendantListEntry, SubagentListEntry,
} from '@deepseek-ai/dsh-subagent'
import { assertNever } from '@deepseek-ai/dsh-util-values'

type ListAgentsScope = 'children' | 'descendants'

interface ListAgentsRequest {
  readonly scope?: ListAgentsScope
}

interface ListAgentsSpec {
  readonly scope: ListAgentsScope
}

/** Progress of one continuable child, summarized from its observed Session log. */
export interface SubagentProgress {
  readonly steps: number
  readonly lastTool?: { readonly name: string; readonly description?: string }
  readonly idleMs: number
}

/** Model-facing progress object carried by each continuable child row. */
export const PROGRESS_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    steps: { type: 'integer', required: true },
    lastTool: {
      type: 'object',
      additionalProperties: false,
      properties: {
        name: { type: 'string', required: true },
        description: { type: 'string' },
      },
    },
    idleMs: { type: 'integer', required: true },
  },
} as const

type ListAgentsEntry =
  | ListAgentsChild
  | {
    readonly kind: 'diagnostic'
    readonly id: SessionId
    readonly reason: 'corrupt' | 'unsupported' | 'unavailable'
    readonly parent?: SessionId
    readonly depth?: number
  }

/** One direct continuable child row, with its registry status and optional progress. */
export type ListAgentsChild = {
  readonly kind: 'child'
  readonly id: SessionId
  readonly label: string
  readonly status: 'running' | 'inactive'
  readonly parent?: SessionId
  readonly depth?: number
  readonly progress?: SubagentProgress
}

/** Resolve the optional model request into an internal required-scope spec. */
function resolveListAgentsRequest(request: ListAgentsRequest): ListAgentsSpec {
  return { scope: request.scope ?? 'children' }
}

/** Report turn activity without exposing whether the child is loaded. */
function statusOf(agents: { get(id: SessionId): Agent | undefined }, id: SessionId): 'running' | 'inactive' {
  return agents.get(id)?.status === 'running' ? 'running' : 'inactive'
}

/** Project one service row into the model-facing entry, or omit a one-shot child. */
function project(
  agents: { get(id: SessionId): Agent | undefined },
  entry: SubagentCatalogEntry | SubagentListEntry,
  position?: Pick<SubagentDescendantListEntry, 'parentId' | 'depth'>,
): ListAgentsEntry | undefined {
  const at = position === undefined ? {} : { parent: position.parentId, depth: position.depth }
  if ('kind' in entry && entry.kind === 'diagnostic') {
    return { kind: 'diagnostic', id: entry.id, reason: entry.reason, ...at }
  }
  // One-shot children cannot be continued by send_message, so the model
  // never selects them; discovery still traversed them for descendants.
  if (entry.mode !== 'continuable') return undefined
  return {
    kind: 'child',
    id: entry.id,
    label: entry.label,
    status: statusOf(agents, entry.id),
    ...at,
  }
}

/**
 * List the caller's direct continuable children with registry status, without reading their logs.
 * @param ctx - context carrying the subagent service and live Agent registry.
 * @param parent - exact live caller whose children are listed.
 * @param signal - cancellation forwarded to the catalog read.
 * @returns continuable children in catalog order.
 */
export async function listContinuableChildren(
  ctx: Context,
  parent: Agent,
  signal: AbortSignal,
): Promise<ListAgentsChild[]> {
  const entries = await ctx.subagents.listChildren(parent.id, signal)
  return entries.flatMap((entry) => {
    const row = project(ctx.agents, entry)
    return row?.kind === 'child' ? [row] : []
  })
}

/** Read a tool call's JSON arguments for its `description` string, if it has one. */
function toolDescription(args: string): string | undefined {
  try {
    const { description } = JSON.parse(args) as { description?: unknown }
    return typeof description === 'string' ? description : undefined
  } catch {
    return undefined
  }
}

/** Summarize one child's log: step count, latest tool call, and time since its last event. */
function summarizeProgress(events: readonly SessionEvent[], now: number): SubagentProgress {
  const call = events.findLast(event => event.type === 'tool/call')
  const latest = events.reduce((time, event) => Math.max(time, event.time), 0)
  const description = call === undefined ? undefined : toolDescription(call.data.arguments)
  return {
    steps: events.filter(event => event.type === 'step/start').length,
    ...call === undefined ? {} : {
      lastTool: { name: call.data.name, ...description === undefined ? {} : { description } },
    },
    idleMs: now - latest,
  }
}

/** Observe one child's log through the query service; undefined when that log cannot be read. */
async function observeProgress(ctx: Context, id: SessionId, signal: AbortSignal): Promise<SubagentProgress | undefined> {
  const query = ctx.get('sessionQuery')
  /* v8 ignore next -- listChildren rejects a missing query service before rows reach progress. */
  if (query === undefined) return undefined
  try {
    using observation = await query.observeSession(id, { signal, projectionMode: 'none' })
    return summarizeProgress(observation.events, Date.now())
  } catch {
    signal.throwIfAborted()
    return undefined
  }
}

/**
 * Attach a progress summary to each child row whose log can be read.
 * @param ctx - context carrying the Session query service.
 * @param entries - rows to annotate; diagnostics pass through unchanged.
 * @param signal - cancellation for the per-child observations.
 * @returns the rows in input order.
 */
export async function withProgress<T extends ListAgentsEntry>(
  ctx: Context,
  entries: readonly T[],
  signal: AbortSignal,
): Promise<T[]> {
  return await Promise.all(entries.map(async (entry) => {
    if (entry.kind !== 'child') return entry
    const progress = await observeProgress(ctx, entry.id, signal)
    return progress === undefined ? entry : { ...entry, progress }
  }))
}

/** Render one progress summary as the parenthesized suffix of a child's text row. */
function progressSuffix(progress: SubagentProgress | undefined): string {
  if (progress === undefined) return ''
  const tool = progress.lastTool === undefined
    ? ''
    : `, last tool ${progress.lastTool.name}${progress.lastTool.description === undefined ? '' : ` "${progress.lastTool.description}"`}`
  return ` (steps ${progress.steps}${tool}, idle ${Math.round(progress.idleMs / 1000)}s)`
}

/**
 * Register the `list_agents` tool.
 * @param ctx - context carrying the tool registry, subagent service, and live Agent registry.
 */
export function registerListAgents(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'list_agents',
    description:
      'List subagents you started, with their ids, labels, status, and progress. '
      + 'running means it is working; inactive means it is not currently working. '
      + 'progress shows its step count, last tool call, and idle time. '
      + 'You will be notified when a subagent finishes; there is no need to keep checking its status. '
      + 'Use send_message to continue the conversation, or interrupt_agent to stop a running subagent.',
    parameters: {
      scope: {
        type: 'string',
        enum: ['children', 'descendants'],
        description: 'children (default) lists direct children, which accept send_message in any status. '
          + 'descendants lists the whole tree below you with each entry\'s parent session id and depth; entries deeper than 1 accept only interrupt_agent.',
      },
    },
    output: {
      schema: {
        type: 'array',
        items: {
          oneOf: [
            {
              type: 'object',
              additionalProperties: false,
              properties: {
                kind: { type: 'string', required: true, enum: ['child'] },
                id: { type: 'string', required: true },
                label: { type: 'string', required: true },
                status: { type: 'string', required: true, enum: ['running', 'inactive'] },
                parent: { type: 'string' },
                depth: { type: 'number' },
                progress: PROGRESS_VALUE_SCHEMA,
              },
            },
            {
              type: 'object',
              additionalProperties: false,
              properties: {
                kind: { type: 'string', required: true, enum: ['diagnostic'] },
                id: { type: 'string', required: true },
                reason: { type: 'string', required: true, enum: ['corrupt', 'unsupported', 'unavailable'] },
                parent: { type: 'string' },
                depth: { type: 'number' },
              },
            },
          ],
        },
      },
      render: (args, entries) => {
        const request = resolveListAgentsRequest(args)
        return [{
          type: 'text',
          text: entries.length === 0
            ? '(no subagents)'
            : entries.map((entry) => {
              // A descendants row always carries its position; children rows
              // never render it. String() spans the schema-optional shape
              // without a dead fallback branch.
              const at = request.scope === 'descendants'
                ? ` parent=${String(entry.parent)} depth=${String(entry.depth)}`
                : ''
              return entry.kind === 'child'
                ? `${entry.id} [${entry.status}]${at} — ${entry.label}${progressSuffix(entry.progress)}`
                : `${entry.id} [diagnostic: ${entry.reason}]${at}`
            }).join('\n'),
        }]
      },
    },
    async execute(args, exec) {
      const parent = exec.agent
      if (!parent) {
        // Non-agent callers have no session whose children could be listed.
        throw new Error('list_agents requires a calling agent (exec.agent was undefined)')
      }
      const request = resolveListAgentsRequest(args)
      switch (request.scope) {
        case 'children': {
          const children = await listContinuableChildren(ctx, parent, exec.signal)
          return await withProgress(ctx, children, exec.signal)
        }
        case 'descendants': {
          const entries = await ctx.subagents.listDescendants(parent.id, exec.signal)
          const rows = entries
            .map(entry => project(ctx.agents, entry, entry))
            .filter(entry => entry !== undefined)
          return await withProgress(ctx, rows, exec.signal)
        }
        /* v8 ignore next 2 -- the resolver normalizes the schema-validated closed scope before dispatch. */
        default:
          return assertNever(request.scope, 'list_agents scope')
      }
    },
  }))
}

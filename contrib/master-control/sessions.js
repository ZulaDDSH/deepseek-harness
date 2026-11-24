export const preset = 'desktop-master-control'
export const homePrefix = 'desktop-master-control-'

export function isControl(header) {
  return header?.id.startsWith(homePrefix) && header.agentPreset === preset
}

export async function listTargets(ctx, signal) {
  const archived = new Set(ctx.workspaceRegistry.archivedSessionIds)
  const workspaces = new Map()
  for (const workspace of ctx.workspaceRegistry.list()) {
    for (const id of workspace.sessionIds) {
      if (!workspaces.has(id)) workspaces.set(id, workspace.title || workspace.path)
    }
  }
  const {items} = await ctx.sessionController.list({}, signal ?? new AbortController().signal)
  return items.flatMap(({sessionId: id, cwd, origin, blank, formatStatus}) => {
    if (!cwd || origin === 'subagent' || id.startsWith(homePrefix) || blank ||
        archived.has(id) || formatStatus === 'migration-required') return []
    return [{
      id,
      workspace: workspaces.get(id) || 'Ungrouped',
      cwd,
      status: ctx.agents.get(id)?.status || 'closed',
    }]
  })
}

function sameModel(left, right) {
  return left?.provider === right?.provider && left?.model === right?.model &&
    left?.reasoningEffort === right?.reasoningEffort
}

export async function describeTargets(ctx, rows, signal) {
  const providers = new Map(ctx.llm.listProviders().map(({id, name}) => [id, name]))
  const metadata = new Map()
  async function describe(selection, source) {
    if (!selection?.provider || !selection.model) return undefined
    const {provider, model, reasoningEffort} = selection
    const key = JSON.stringify([provider,model])
    if (!metadata.has(key)) {
      metadata.set(key, ctx.llm.resolveModelInfo(provider,model,signal).catch(() => undefined))
    }
    const info = await metadata.get(key)
    signal?.throwIfAborted()
    const effort = reasoningEffort ?? (source === 'selected' ? info?.reasoning?.defaultEffort : undefined)
    return {providerId:provider, modelId:model, provider:providers.get(provider) ?? provider,
      model:info?.name ?? model, effort, effortLabel:info?.reasoning?.efforts.find(level=>level.id===effort)?.name ?? effort,
      selectedEffort:reasoningEffort, source}
  }
  return Promise.all(rows.map(async row => {
    try {
      using observation = await ctx.sessionQuery.observeSession(row.id, {signal})
      const {title, modelSelection} = observation.projections?.values ?? {}
      const agent = ctx.agents.get(row.id)
      const status = agent?.status || 'closed'
      // The selection projection can omit adapter-defaulted effort and this runtime
      // has no last-used cursor. The durable header has the actual request config.
      const lastRequest = observation.events.findLast(event => event.type === 'request/header')
      const requested = lastRequest?.data.header.config
      const selected = modelSelection?.next ?? modelSelection?.pending ??
        agent?.model.current() ?? modelSelection?.lastUsed
      const open = agent && ctx.agents.turnBoundaryOf(agent.session).openTurnStartSeq
      const running = status === 'running' && open != null && lastRequest?.seq >= open
      const source = running ? 'running' : status === 'running' && requested ? 'last-request' : selected ? 'selected' : 'last-request'
      const [model, next] = await Promise.all([
        describe(source === 'selected' ? selected : requested,source),
        describe(selected,'selected'),
      ])
      return {
        ...row, status, title: typeof title === 'string' ? title.slice(0, 160) : row.id,
        model, selected:next,
        showNext:status === 'running' && model && next &&
          !sameModel({provider:model.providerId,model:model.modelId,reasoningEffort:model.effort},
            {provider:next.providerId,model:next.modelId,reasoningEffort:next.effort}),
      }
    } catch (error) {
      signal?.throwIfAborted()
      if (error.code !== 'SESSION_QUERY_SESSION_NOT_FOUND') throw error
      return {...row, title:row.id}
    }
  }))
}

export async function assertTarget(ctx, id, signal) {
  if (typeof id !== 'string' || !(await listTargets(ctx,signal)).some(row=>row.id===id))
    throw new Error('That session is unavailable.')
}

export async function resolveTarget(ctx, id, signal) {
  await assertTarget(ctx,id,signal)
  const found = await ctx.sessionController.resolveAgent(id)
  if (found.error) throw new Error(found.error.message)
  signal?.throwIfAborted()
  if (ctx.workspaceRegistry.archivedSessionIds.includes(id) || ctx.agents.get(id) !== found.agent)
    throw new Error('That session is no longer available.')
  return found.agent
}

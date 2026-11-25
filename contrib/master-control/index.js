import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { homePrefix, isControl, listTargets, preset, describeTargets, resolveTarget } from './sessions.js'
import { controlPolicy } from './control-policy.js'

export const name = 'desktop-master-control'
export const inject = ['connection', 'webServer', 'sessions', 'sessionQuery', 'sessionController', 'workspaceRegistry', 'agents', 'llm', 'agentPresets', 'permissionPresets']

export async function apply(ctx) {
  const policy = controlPolicy(ctx)
  await policy.initialize()
  const presetSettings = ctx.get('settings')?.describe({redactSecrets:true})
    .find(row=>row.ns==='agent-preset-registry')
  if (presetSettings) ctx.emit('settings/document-updated',presetSettings.ns,presetSettings.revision)
  let opening
  const refreshed = new WeakMap()
  function refreshHome(agent) {
    if (agent?.status !== 'idle' || !isControl(agent.session.header)) return
    let refresh = refreshed.get(agent)
    if (!refresh) {
      // A live chat can still hold the preset revision from before this update.
      // Rebind its idle agent in place so the chat and its transcript stay open.
      refresh = ctx.agentPresets.recompose(agent.ctx,preset)
        .then(()=>policy.lock(agent))
        .catch(error=>{refreshed.delete(agent); throw error})
      refreshed.set(agent,refresh)
    }
    return refresh
  }
  ctx.on('agent/status',({agent,status})=>{
    if (status === 'idle') void refreshHome(agent)?.catch(error=>ctx.logger.warn(error.message))
  })
  async function findHome(signal) {
    const records = await ctx.sessionQuery.listSessions(signal)
    return records.find(({header}) =>
      isControl(header) && !ctx.workspaceRegistry.archivedSessionIds.includes(header.id))?.header.id
  }
  async function open(signal) {
    const existing = await findHome(signal)
    if (existing) {
      await refreshHome(ctx.agents.get(existing))
      return {sessionId:existing}
    }
    const cwd = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'master-control')
    const result = await policy.create({sessionId:homePrefix + randomUUID(), agentPreset:preset, cwd})
    await ctx.sessionController.rename({sessionId:result.sessionId, title:'Master Control'})
    const session = ctx.sessions.get(result.sessionId)
    if (!session || !await ctx.sessions.flush(session)) throw new Error('Could not save the control chat.')
    return result
  }
  ctx.connection.register(ctx, '/desktop-master-control', async (method, args, signal, peer) => {
    if (peer?.principal?.kind !== 'owner') return {ok:false, error:{code:'forbidden', message:'Only the Harness owner can open Master Control.', details:{}}}
    try {
      if (method === 'current') {
        const sessionId = await findHome(signal)
        if (sessionId) await refreshHome(ctx.agents.get(sessionId))
        return {ok:true,value:{sessionId:sessionId ?? null}}
      }
      if (method === 'open') {
        opening ??= open(signal).finally(() => {opening = undefined})
        return {ok:true, value:await opening}
      }
      if (method === 'providers') return {ok:true, value:ctx.llm.listProviders()}
      if (method === 'models') return {ok:true, value:await ctx.llm.listModels(args?.provider)}
      if (method === 'efforts') {
        const info = await ctx.llm.resolveModelInfo(args?.provider,args?.model,signal)
        return {ok:true, value:info.reasoning ?? null}
      }
      if (method === 'select-model') {
        const {id,provider,model,effort} = args ?? {}
        if (typeof provider !== 'string' || !provider || typeof model !== 'string' || !model ||
            (effort !== undefined && (typeof effort !== 'string' || !effort)))
          throw new Error('Choose a provider, model, and supported effort.')
        const selection = {provider,model,...(effort && {reasoningEffort:effort})}
        await ctx.llm.resolveCallConfig(selection,signal)
        const agent = await resolveTarget(ctx,id,signal)
        agent.model.select(selection)
        return {ok:true,value:{selected:selection}}
      }
      if (method !== 'list') throw new Error('Unknown Master Control action.')
      const kind = args?.kind === 'fixer' ? 'fixer' : 'workspace'
      const candidates = await listTargets(ctx, signal, kind)
      const offset = Number.isSafeInteger(args?.offset) && args.offset > 0 ? args.offset : 0
      const rows = await describeTargets(ctx, candidates.slice(offset, offset + 36), signal)
      return {ok:true, value:{rows, total:candidates.length, kind}}
    } catch (error) {
      return {ok:false, error:{code:'master-control/unavailable', message:error.message, details:{}}}
    }
  })
}

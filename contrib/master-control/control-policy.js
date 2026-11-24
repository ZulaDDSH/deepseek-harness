import { symbols } from '@deepseek-ai/cordis'
import { homePrefix, isControl, preset } from './sessions.js'

const fullAccess = 'danger-full-access'

// Cordis binds service reads to the caller. Install on the service instance so
// the same policy applies through ordinary calls and the RPC service view.
function intercept(ctx, service, method, handler) {
  const owner = service[symbols.original] ?? service
  const previous = Object.getOwnPropertyDescriptor(owner,method)
  const original = Reflect.get(owner,method)
  if (typeof original !== 'function') throw new Error('Missing Harness method: '+method)
  const guarded = function (...args) {return handler(original,this,args)}
  ctx.effect(()=>{
    Object.defineProperty(owner,method,{value:guarded,writable:true,configurable:true})
    return ()=>{
      if (owner[method] !== guarded) return
      if (previous) Object.defineProperty(owner,method,previous)
      else Reflect.deleteProperty(owner,method)
    }
  }, 'Master Control: '+method)
}

/** Keep the private preset and permission lock scoped to the dedicated chat. */
export function controlPolicy(ctx) {
  const dedicatedRequests = new WeakSet()
  const installedCommands = new Map()

  intercept(ctx,ctx.agentPresets,'remoteExportList',async (original,receiver,args)=>{
    const roster = await original.apply(receiver,args)
    return {...roster,presets:roster.presets.filter(option=>option.id!==preset)}
  })
  intercept(ctx,ctx.agentPresets,'select',(original,receiver,args)=>{
    const [agent,next] = args
    if (isControl(agent.session.header) ? next!==preset : next===preset) {
      return Promise.reject(new Error('Master Control mode is reserved for the Master Control tab.'))
    }
    return original.apply(receiver,args)
  })
  intercept(ctx,ctx.sessionController,'create',(original,receiver,args)=>{
    const [request] = args
    const privateMode = request?.agentPreset === preset || request?.sessionId?.startsWith(homePrefix)
    if (privateMode && !dedicatedRequests.has(request))
      return Promise.reject(new Error('Open the Master Control tab to use its dedicated chat.'))
    return original.apply(receiver,args)
  })

  async function lock(agent) {
    if (!isControl(agent.session.header)) return
    const previous = ctx.permissionPresets.current(agent.session)
    if (previous !== fullAccess) ctx.permissionPresets.set(agent.session,fullAccess)
    let commands = installedCommands.get(agent)
    if (!commands) {
      commands = agent.ctx.inject(['commands'], scope=>{
        scope.commands.register({
          definitionId:'dsh-master-control/locked-permission',
          name:'permission',
          description:'Show the fixed Full access preset for Master Control.',
          handler:({rawInput})=>rawInput.trim()
            ? {kind:'error',text:'Master Control permissions are locked to Full access.'}
            : {kind:'success',text:'Full access is locked for Master Control.'},
        })
      })
      installedCommands.set(agent,commands)
    }
    await commands
  }
  ctx.on('agent/created',({agent})=>lock(agent))
  ctx.on('agent/disposed',({agent})=>{
    const commands = installedCommands.get(agent)
    installedCommands.delete(agent)
    return commands?.dispose()
  })
  ctx.effect(()=>()=>{
    const releases = [...installedCommands.values()]
    installedCommands.clear()
    return Promise.all(releases.map(commands=>commands.dispose()))
  },'Master Control: scoped permission lock')

  return {
    async create(request) {
      dedicatedRequests.add(request)
      try {return await ctx.sessionController.create(request)}
      finally {dedicatedRequests.delete(request)}
    },
    initialize:()=>Promise.all(ctx.agents.list().map(lock)),
    lock,
  }
}

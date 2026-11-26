import {randomUUID} from 'node:crypto'
import {label} from './partitions.js'

const root='https://opencode.ai/inference/go'
const baseURL=root+'/openai/v1'
const api='openai-completions'
const prefix='OpenCode Go · '
const route=/^opencode-go-account-[a-f0-9]{32}$/
const credential=id=>'DSH_'+id.toUpperCase().replaceAll('-','_')+'_KEY'
const efforts=['off','minimal','low','medium','high','xhigh','max']

function chatModels(rows) {
  const seen=new Set()
  return rows.flatMap(model=>{
    if(model?.type!=='chat' || typeof model.id!=='string' || !model.id.trim() || seen.has(model.id)) return []
    seen.add(model.id)
    const input=model.modalities?.input ?? []
    const reasoningEfforts=Object.fromEntries(efforts.filter(effort=>model.capabilities?.reasoning?.effort?.includes(effort))
      .map(effort=>[effort,effort==='off'?null:effort]))
    const {context,output}=model.limit ?? {}
    return [{
      id:model.id,name:typeof model.name==='string' && model.name.trim() ? model.name : model.id,
      input:['text',...(Array.isArray(input) && input.some(type=>typeof type==='string' && type.startsWith('image/'))?['image']:[])],
      ...(Number.isSafeInteger(context) && context>0 && {contextWindow:context}),
      ...(Number.isSafeInteger(output) && output>0 && {maxTokens:output}),
      ...(Object.keys(reasoningEfforts).length && {reasoningEfforts,compat:{supportsReasoningEffort:true,thinkingFormat:'openai'}}),
    }]
  })
}

async function probe(key,signal) {
  const deadline=AbortSignal.timeout(15000)
  const request={headers:{Authorization:'Bearer '+key,Accept:'application/json'},redirect:'error',
    signal:signal ? AbortSignal.any([signal,deadline]) : deadline}
  const usage=await fetch(root+'/v1/usage',request)
  if(usage.status===401 || usage.status===403) throw new Error('That key could not authenticate an active OpenCode Go account.')
  if(!usage.ok) throw new Error('OpenCode Go could not verify this key. Try again.')
  await usage.body?.cancel()
  const listing=await fetch(root+'/v1/models',request)
  if(!listing.ok) throw new Error('OpenCode Go could not list models for this key. Check that it can read models.')
  const payload=await listing.json()
  const models=chatModels(Array.isArray(payload?.data)?payload.data:[])
  if(!models.length) throw new Error('OpenCode Go returned no chat models for this key.')
  return models
}

export function openCodeAccounts(ctx) {
  function source() {
    const descriptor=ctx.llm.listConfigurableProviders().find(row=>row.provider==='opencode-go')
    const section=descriptor && ctx.settings.describe({redactSecrets:true}).find(row=>row.ns===descriptor.settingsNs)
    if(!section) throw new Error('OpenCode Go is unavailable in this profile.')
    const entries=Object.entries(section.value.providers ?? {}).filter(([id,config])=>
      route.test(id) && config.apiKeyEnv===credential(id) && config.baseURL===baseURL && config.api===api)
    return {section,entries}
  }
  async function list() {
    const {entries}=source()
    return Promise.all(entries.map(async ([id,config])=>({
      id,name:(config.displayName || id).replace(/^OpenCode Go · /,''),
      configured:(await ctx.credentials.describe(credential(id))).configured,
      models:config.models?.length ?? 0,
    })))
  }
  async function write(method,args,signal) {
    const {section,entries}=source()
    const name=label(args.name)
    if(method==='rename') {
      const id=entries.find(([id])=>id===args.id)?.[0]
      if(!id) throw new Error('This account is no longer available.')
      await ctx.settings.mutate(section.ns,[{op:'set',path:['providers',id,'displayName'],value:prefix+name}],section.revision)
      return list()
    }
    const key=typeof args.key==='string'?args.key.trim():''
    if(!/^[\x21-\x7e]{1,2048}$/.test(key)) throw new Error('Paste an OpenCode Go API key.')
    for(const [id] of entries) {
      if((await ctx.credentials.resolve(credential(id)))?.value===key) throw new Error('That API key is already connected.')
    }
    const models=await probe(key,signal)
    signal?.throwIfAborted()
    const id='opencode-go-account-'+randomUUID().replaceAll('-','')
    const ref=credential(id)
    await ctx.credentials.set(ref,key)
    try {
      await ctx.settings.mutate(section.ns,[{op:'set',path:['providers',id],value:{api,baseURL,apiKeyEnv:ref,displayName:prefix+name,models}}],section.revision)
    } catch(error) {
      await ctx.credentials.unset(ref)
      throw error
    }
    return list()
  }
  let pending=Promise.resolve()
  return {list,write(method,args,signal) {
    const task=pending.then(()=>{signal?.throwIfAborted();return write(method,args,signal)})
    pending=task.catch(()=>{})
    return task
  }}
}

export function attachGoSessionHeader(ctx) {
  ctx.on('llm-pi-ai/request-headers',(request,headers,next)=>{
    if(route.test(request.provider) && request.baseURL===baseURL && request.sessionId) {
      headers.set('x-opencode-session',request.sessionId)
    }
    return next()
  })
}

import {randomUUID} from 'node:crypto'
import {mkdir,open,readFile,realpath} from 'node:fs/promises'
import {basename,extname,isAbsolute,join,relative,resolve,sep} from 'node:path'
import {withFileLock,writeFileAtomic} from '@deepseek-ai/dsh-atomic-write'
import {branchState,pinSubmission} from './git.js'
import {answer,review} from './review.js'

function text(value,label,limit,required=false) {
  if (value == null && !required) return ''
  if (typeof value !== 'string' || value.trim().length > limit || (required && !value.trim()))
    throw new Error('Enter a valid '+label+' (up to '+limit+' characters).')
  return value.trim()
}
function lookup(state,id) {
  const row = state.rows.find(item=>item.id===id)
  if (!row) throw new Error('Review not found.')
  return row
}
const sameScope = (left,right) => left.leadId===right.leadId && left.repo===right.repo &&
  (left.pull || right.pull ? left.pull?.url===right.pull?.url : left.branch===right.branch)

async function capturePair(ctx,args,repo,restricted,selection,signal) {
  const paths=[args.beforeCapture,args.afterCapture]
  if (!paths.some(Boolean)) return []
  const info=await ctx.llm.resolveModelInfo(selection.provider,selection.model,signal)
  if (info.inputModalities && !info.inputModalities.includes('image'))
    throw new Error('Choose an image-capable reviewer for capture evidence.')
  const captures=[]
  for (const [i,path] of paths.entries()) {
    if(!path) continue
    const file=await realpath(resolve(repo,text(path,'capture path',2048,true)))
    const inside=relative(repo,file)
    if(restricted && (inside.startsWith('..'+sep) || inside==='..' || isAbsolute(inside)))
      throw new Error('Choose a capture inside the submitted repository.')
    const mediaType={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp'}[extname(file).toLowerCase()]
    if(!mediaType) throw new Error('Choose a PNG, JPEG, or WebP capture.')
    const handle=await open(file,'r')
    try {
      const stat=await handle.stat()
      if(!stat.isFile() || stat.size>12*1024*1024) throw new Error('Each capture must be a file under 12 MiB.')
      const data=Buffer.alloc(stat.size)
      let offset=0
      while(offset<data.length) {
        const {bytesRead}=await handle.read(data,offset,data.length-offset,offset)
        if(!bytesRead) throw new Error('The capture changed during submission. Submit it again.')
        offset+=bytesRead
      }
      const ref=await ctx.attachments.saveImage({data,mediaType,name:basename(file)})
      captures.push({side:i===0?'Before':'After',ref})
    }finally{await handle.close()}
  }
  return captures
}

export async function openQueue(ctx,deliver) {
  const dir = join(ctx.profileContext.dir,'auto-auditor')
  await mkdir(dir,{recursive:true})
  const filename = join(dir,'queue.json')
  const life = new AbortController()
  const patchPath = id => join(dir,id+'.diff')
  async function read() {
    try {return JSON.parse(await readFile(filename,'utf8'))}
    catch(error) {if(error.code==='ENOENT') return {model:null,rows:[]}; throw error}
  }
  function mutate(edit) {
    return withFileLock(filename,async()=>{
      const state=await read()
      const result=await edit(state)
      await writeFileAtomic(filename,JSON.stringify(state),{mode:0o600})
      return result
    })
  }
  function change(id,edit) {return mutate(state=>{
    const row=lookup(state,id)
    edit(row)
    row.revision=(row.revision || 0)+1
  })}
  async function selectModel(args) {
    if (args.inherit === true) return mutate(state=>state.model=null)
    const provider=text(args.provider,'provider',300,true),model=text(args.model,'model',300,true)
    const effort=text(args.reasoningEffort,'effort',80)
    const selection={provider,model,...(effort && {reasoningEffort:effort})}
    await ctx.llm.resolveCallConfig(selection,life.signal)
    return mutate(state=>state.model=selection)
  }
  async function submit(lead,args,restricted,signal) {
    const state = await read()
    const model=state.model ?? lead.model
    if (!model?.provider || !model.model) throw new Error('Choose a reviewer model in Auto Auditor. This lead has no selected model.')
    const selection={provider:model.provider,model:model.model,...(model.reasoningEffort && {reasoningEffort:model.reasoningEffort})}
    await ctx.llm.resolveCallConfig(selection,signal)
    const prior = args.previous ? lookup(state,args.previous) : undefined
    if (prior && prior.leadId!==lead.id) throw new Error('This review belongs to another lead.')
    const pullRequest=text(args.pull_request,'pull request',500) || prior?.pull?.url
    const evidence = text(args.evidence,'test or capture evidence',16000)
    const pin = await pinSubmission({cwd:lead.cwd,repository:text(args.repository ?? prior?.repo,'repository path',2000),
      branch:args.branch ?? prior?.branch,commit:args.commit,base:args.base,pullRequest,previous:prior,restricted},signal)
    const {patch,...range} = pin
    const goal = text(args.goal ?? prior?.goal ?? (pin.pull && 'Review PR #'+pin.pull.number),'review goal',4000,true)
    const captures=await capturePair(ctx,args,pin.repo,restricted,selection,signal)
    const row = {id:randomUUID(),created:Date.now(),leadId:lead.id,leadTitle:lead.title,workspace:lead.workspace,
      ...range,goal,evidence,captures,status:'queued',model:selection}
    if (prior && !sameScope(row,prior)) throw new Error('A follow-up must use the same lead, repository, and PR or branch.')
    const result = await mutate(async latest=>{
      const previous = prior ?? latest.rows.find(item=>sameScope(row,item) && item.base===row.base)
      const existing = latest.rows.find(item=>sameScope(row,item) && item.head===row.head && item.base===row.base &&
        item.pull?.target===row.pull?.target && item.goal===goal && item.evidence===evidence && item.status!=='failed' &&
        JSON.stringify((item.captures || []).map(c=>[c.side,c.ref.attachmentId]))===JSON.stringify(captures.map(c=>[c.side,c.ref.attachmentId])))
      if (existing) return {id:existing.id,status:existing.status,head:existing.head}
      if (previous) row.previous=previous.id
      await writeFileAtomic(patchPath(row.id),patch,{mode:0o600})
      latest.rows.unshift(row)
      return {id:row.id,status:'queued',head:row.head}
    })
    wake()
    return result
  }
  async function detail(id,signal) {
    const state=await read(), row=lookup(state,id)
    const [patch,branch]=await Promise.all([readFile(patchPath(row.id),'utf8'),branchState(row,signal)])
    return {row,patch,branch,previous:row.previous ? lookup(state,row.previous) : undefined}
  }
  async function retry(id) {
    await mutate(state=>{
      const row=lookup(state,id)
      if (row.status!=='failed') throw new Error('Only a failed review can be retried.')
      row.model=state.model ?? row.model
      row.status='queued'
      row.interruptions=0
      row.revision=(row.revision || 0)+1
      delete row.error
    })
    wake()
  }
  async function retryDelivery(id,target) {
    if (!['lead','master'].includes(target)) throw new Error('Unknown recipient.')
    await change(id,row=>{
      if (!['failed','uncertain'].includes(row.delivery?.[target])) throw new Error('This delivery is not awaiting a retry.')
      row.delivery[target]='pending'
    })
    wake()
  }
  async function sendMessage(id,author,body) {
    const value=text(body,'message',4000,true)
    const msg=await mutate(state=>{
      const row=lookup(state,id)
      if(!author.master && author.id!==row.leadId) throw new Error('Review not found.')
      const messages=row.messages ??= []
      const existing=messages.findLast(item=>item.author===author.id && item.body===value && item.status!=='failed')
      if(existing) {
        if(existing.delivery==='failed') {
          existing.delivery='pending'
          delete existing.deliveryError
          row.revision=(row.revision || 0)+1
        }
        return existing
      }
      if(messages.length>=60) throw new Error('This review has reached its conversation limit. Use a follow-up review for new evidence.')
      const message={id:randomUUID(),author:author.id,role:author.master?'Master Control':row.leadTitle,body:value,created:Date.now(),status:'queued'}
      messages.push(message)
      row.revision=(row.revision || 0)+1
      return message
    })
    wake()
    return {reviewId:id,messageId:msg.id,status:msg.status}
  }
  function messageChange(row,id,edit) {
    return change(row,item=>edit(item.messages.find(message=>message.id===id)))
  }
  async function notify(row,target,message) {
    const update=(status,error)=>message ? messageChange(row.id,message.id,item=>{
      item.delivery=status
      item.deliveryError=error
    }) : change(row.id,item=>{
      item.delivery[target]=status
      item.deliveryErrors??={}
      if(error) item.deliveryErrors[target]=error
      else delete item.deliveryErrors[target]
    })
    await update('sending')
    try {
      await deliver(row,target,life.signal,message)
    } catch(error) {
      await update(life.signal.aborted?'pending':'failed',error.message)
      return
    }
    await update('sent')
  }
  async function drain() {
    // Only the holder can recover an interrupted worker or deliver an outbox item.
    await withFileLock(join(dir,'worker'),async()=>{
      let state=await read()
      if (state.rows.some(row=>row.status==='reviewing' || Object.values(row.delivery ?? {}).includes('sending') ||
          row.messages?.some(message=>message.status==='answering' || message.delivery==='sending'))) {
        await mutate(state=>{
          for (const row of state.rows) {
            if (row.status==='reviewing') {
              row.interruptions=(row.interruptions || 0)+1
              row.status=row.interruptions<=2?'queued':'failed'
              if(row.status==='failed') row.error='Review was interrupted repeatedly. Retry when ready.'
            }
            for(const key of Object.keys(row.delivery ?? {})) if(row.delivery[key]==='sending') row.delivery[key]='pending'
            for(const message of row.messages ?? []) {
              if(message.status==='answering') {
                message.interruptions=(message.interruptions || 0)+1
                message.status=message.interruptions<=2?'queued':'failed'
                if(message.status==='failed') message.error='Reply was interrupted repeatedly. Send the question again to retry.'
              }
              if(message.delivery==='sending') message.delivery='pending'
            }
            row.revision=(row.revision || 0)+1
          }
        })
      }
      while (!life.signal.aborted) {
        state=await read()
        const outbound=state.rows.find(row=>Object.values(row.delivery ?? {}).includes('pending'))
        if (outbound) {
          const target=Object.keys(outbound.delivery).find(key=>outbound.delivery[key]==='pending')
          await notify(outbound,target)
          continue
        }
        const row=state.rows.findLast(item=>item.status==='queued')
        if (!row) {
          const threaded=state.rows.findLast(item=>item.messages?.some(message=>message.status==='queued' || message.delivery==='pending'))
          if(!threaded) return
          const message=threaded.messages.find(item=>item.status==='queued' || item.delivery==='pending')
          if(message.delivery==='pending') await notify(threaded,null,message)
          else {
            await messageChange(threaded.id,message.id,item=>{item.status='answering'})
            try {
              const signal=AbortSignal.any([life.signal,AbortSignal.timeout(10*60_000)])
              const response=await answer(ctx,threaded,await readFile(patchPath(threaded.id),'utf8'),message,signal)
              await messageChange(threaded.id,message.id,item=>{item.answer=response;item.status='answered';item.delivery='pending'})
            } catch(error) {
              if(life.signal.aborted) return
              await messageChange(threaded.id,message.id,item=>{item.status='failed';item.error=String(error.message).slice(0,800)})
            }
          }
          continue
        }
        await change(row.id,item=>{item.status='reviewing'})
        try {
          const signal=AbortSignal.any([life.signal,AbortSignal.timeout(10*60_000)])
          const result=await review(ctx,row,await readFile(patchPath(row.id),'utf8'),state.rows.find(x=>x.id===row.previous),signal)
          await change(row.id,item=>{
            item.result=result
            item.status=result.status
            item.finished=Date.now()
            item.delivery={lead:'pending',...(result.status==='needs_run' && {master:'pending'})}
          })
        } catch(error) {
          if(life.signal.aborted) return
          await change(row.id,item=>{item.status='failed';item.error=String(error.message).slice(0,800)})
        }
      }
    },{signal:life.signal})
  }
  let worker, requested=false
  function wake() {
    requested=true
    if (worker || life.signal.aborted) return
    worker=(async()=>{
      while(requested && !life.signal.aborted) {requested=false;await drain()}
    })().catch(error=>{if(!life.signal.aborted) ctx.logger.warn('Auto Auditor: '+error.message)}).finally(()=>{
      worker=undefined
      if(requested && !life.signal.aborted) wake()
    })
  }
  ctx.effect(()=>{
    const timer=setInterval(()=>{if(!worker) wake()},15000)
    timer.unref()
    return ()=>{clearInterval(timer);life.abort();return worker}
  },'Auto Auditor review worker')
  wake()
  const tip=async(id,signal)=>branchState(lookup(await read(),id),signal)
  async function capture(id,side,signal) {
    const ref=lookup(await read(),id).captures?.find(c=>c.side===side)?.ref
    if(!ref) throw new Error('This review has no such capture.')
    const {data}=await ctx.attachments.readImage(ref,signal)
    return 'data:'+ref.mediaType+';base64,'+Buffer.from(data).toString('base64')
  }
  return {read,selectModel,submit,detail,tip,capture,retry,retryDelivery,sendMessage}
}

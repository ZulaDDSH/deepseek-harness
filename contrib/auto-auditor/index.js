import {createUserMessage} from '@deepseek-ai/dsh-llm'
import {defineTool} from '@deepseek-ai/dsh-tools'
import {openQueue} from './queue.js'
import {branchState} from './git.js'
import {registerPullTools} from './pull-workflow.js'
import {registerMasterAwareness} from './master-awareness.js'

export const name='desktop-auto-auditor'
export const inject=['profileContext','connection','webServer','tools','agents','sessions','llm','sessionController','sessionQuery','workspaceRegistry','permissionPresets','attachments']
const controlPrefix='desktop-master-control-'
const channel='/desktop-auto-auditor'
const isMaster=agent=>agent.id.startsWith(controlPrefix) && agent.session.header.agentPreset==='desktop-master-control'

function header(row) {
  return {id:row.id,leadId:row.leadId,leadTitle:row.leadTitle,goal:row.goal,status:row.status,head:row.head,
    branch:row.branch,pull:row.pull?.url,repair:row.repair?.url,created:row.created,revision:row.revision,
    ...(row.fixerJob?.state==='sent' && {fixerSessionId:row.fixerJob.sessionId}),
    ...(row.fixerJob?.state && {fixerState:row.fixerJob.state}),
    ...(row.repair && {repairOriginal:row.repair.original,repairPublished:row.repair.published===true})}
}

export async function apply(ctx) {
  async function leads(signal) {
    const archived=new Set(ctx.workspaceRegistry.archivedSessionIds)
    const workspaces=new Map()
    for(const workspace of ctx.workspaceRegistry.list())
      for(const id of workspace.sessionIds) workspaces.set(id,workspace.title || workspace.path)
    const {items}=await ctx.sessionController.list({},signal)
    return items.filter(item=>item.cwd && item.origin!=='subagent' && !item.sessionId.startsWith(controlPrefix) &&
      !archived.has(item.sessionId) && item.formatStatus!=='migration-required').map(item=>{
      const values=item.projections?.values ?? {}
      const model=ctx.agents.get(item.sessionId)?.model.current() ?? values.modelSelection?.next ?? values.modelSelection?.lastUsed
      return {id:item.sessionId,cwd:item.cwd,title:values.title || item.sessionId,workspace:workspaces.get(item.sessionId) || 'Ungrouped',model}
    })
  }
  async function lead(id,signal,needModel=false) {
    const item=(await leads(signal)).find(row=>row.id===id)
    if(!item) throw new Error('The originating lead session is unavailable or archived.')
    if(needModel && !item.model?.model) {
      using view=await ctx.sessionQuery.observeSession(id,{signal})
      const selection=view.projections?.values?.modelSelection
      item.model=selection?.next ?? selection?.pending ?? view.events.findLast(event=>event.type==='request/header')?.data.header.config
    }
    return item
  }
  async function deliver(row,target,signal,message) {
    let id
    const label={ready:row.repair?'Repair approved':'Ready to push',changes_requested:'Changes requested',needs_run:'Run requested'}[row.status]
    let body
    if(message) {
      id=message.author
      body='Auto Auditor reply · Review '+row.id+'\n'+(row.pull?.url || row.head)+
        '\nYour message: '+message.body+'\n\n'+message.answer
    } else if(target==='master') {
      const archived=new Set(ctx.workspaceRegistry.archivedSessionIds)
      const home=(await ctx.sessionQuery.listSessions(signal)).find(({header})=>
        header.id.startsWith(controlPrefix) && header.agentPreset==='desktop-master-control' && !archived.has(header.id))
      if(!home) throw new Error('Open the dedicated Master Control chat, then retry delivery.')
      id=home.header.id
      body='Auto Auditor requests a run slot for '+row.leadTitle+' ('+row.leadId+').\nReview '+row.id+' · '+(row.pull?.url || row.head)+
        '\nRequested evidence: '+row.result.runRequest+'\nCoordinate the slot with the originating lead.'
    } else {
      id=(await lead(row.leadId,signal)).id
      const current=await branchState(row,signal)
      body='Auto Auditor · '+label+'\nReview '+row.id+'\nReviewed commit '+row.head+' on '+(row.pull?.url || row.repair?.url || row.branch || 'detached HEAD')+
        '\n'+row.result.summary+'\n'+row.result.findings.map(item=>'• '+item).join('\n')+
        (row.result.checks.length ? '\nReviewed checks:\n'+row.result.checks.map(item=>'• '+item).join('\n') : '')+
        (row.result.runRequest ? '\nRun requested through Master Control: '+row.result.runRequest : '')+
        (current.kind!=='current' ? '\nThe current PR or branch differs or could not be verified. Check its latest state before relying on this verdict.' : '')+
        (row.status==='ready' ? (row.repair ? '\nMaster Control can use auditor_publish_fix with review_id='+row.id+'.' :
          '\nThis verdict covers only the listed SHA. Pushing is a separate owner action.') : row.repair ?
          '\nUse auditor_stage_fix with review_id='+row.repair.original+' to review a new repair commit.' :
          '\nUse auditor_submit with previous='+row.id+' to submit the fix or new evidence.')+
        '\nUse auditor_message with review_id='+row.id+' to discuss this review.'
    }
    const {agent,error}=await ctx.sessionController.resolveAgent(id)
    if(!agent || error) throw new Error(error?.message || 'Recipient unavailable.')
    signal.throwIfAborted()
    if(ctx.workspaceRegistry.archivedSessionIds.includes(id)) throw new Error('Recipient has been archived.')
    const seen=source=>source?.kind==='auto-auditor' && source.reviewId===row.id && source.exchangeId===message?.id
    using history=await ctx.sessionQuery.observeSession(id,{signal,projectionMode:'none'})
    if(!agent.inbox.nextTurn.some(item=>seen(item.source)) &&
        !history.events.some(event=>event.type==='user/message' && seen(event.data.source))) {
      agent.followup(createUserMessage({content:[{type:'text',text:body}],source:{
        kind:'auto-auditor',form:'notice',summary:message?'Auto Auditor · Reply':'Auto Auditor · '+label,
        reviewId:row.id,...(message && {exchangeId:message.id}),
      }}))
    }
    if(!await ctx.sessions.flush(agent.session)) throw new Error('The Harness could not confirm that the message was saved.')
  }
  const queue=await openQueue(ctx,deliver)
  const parameter=(description,required=false)=>({type:'string',description,...(required && {required:true})})
  const output={schema:{type:'string'},render:(_args,result)=>[{type:'text',text:result}]}
  async function author(exec) {
    if(!exec.agent || ctx.workspaceRegistry.archivedSessionIds.includes(exec.agent.id)) throw new Error('Use a lead chat or Master Control.')
    if(isMaster(exec.agent)) return {id:exec.agent.id,master:true}
    await lead(exec.agent.id,exec.signal)
    return {id:exec.agent.id,master:false}
  }
  registerPullTools(ctx,{queue,lead,author,parameter,output})
  registerMasterAwareness(ctx,{queue,isMaster})
  ctx.tools.register(defineTool({
    name:'auditor_submit',
    description:'Send a ready GitHub PR or local commit to the always-on Auto Auditor. It reviews the pinned changes and replies to the lead chat. Master Control can submit on behalf of a lead. Use previous for a follow-up verdict.',
    parameters:{pull_request:parameter('Full GitHub PR URL, or PR number if the repository origin is on GitHub.'),
      lead_id:parameter('Exact originating session ID, when submitting on behalf of a lead from Master Control.'),
      goal:parameter('What the change must accomplish. Optional when submitting a GitHub PR.'),
      evidence:parameter('Actual test results, reproduction steps, capture references, and GPU timings.'),
      beforeCapture:parameter('Path to a before image for visual review. Relative paths resolve from the repository.'),
      afterCapture:parameter('Path to an after image for visual review. Relative paths resolve from the repository.'),
      repository:parameter('Repository in your workspace. Defaults to the session directory.'),
      branch:parameter('Local Git branch. Defaults to the checked-out branch.'),commit:parameter('Specific commit SHA. Defaults to the branch tip.'),
      base:parameter('Target ref or base SHA for the review range.'),previous:parameter('Earlier review ID for a follow-up.')},
    output,
    async execute(args,exec) {
      const caller=await author(exec)
      if(caller.master && !args.lead_id) throw new Error('Specify the originating lead’s session ID.')
      if(!caller.master && args.lead_id && args.lead_id!==caller.id) throw new Error('Submit from the originating lead chat.')
      const restricted=ctx.permissionPresets.current(exec.agent.session)!=='danger-full-access'
      return JSON.stringify(await queue.submit(await lead(args.lead_id || caller.id,exec.signal,true),args,restricted,exec.signal))
    },
  }))
  ctx.tools.register(defineTool({
    name:'auditor_status',
    description:'Read Auto Auditor review status, verdicts, fixer assignments, and conversation. Leads see their own reviews. Master Control sees all reviews (use auditor_fixer_status for the PR Fixer repair inbox and settings). Omit review_id to list the 25 latest.',
    parameters:{review_id:parameter('Review ID returned by auditor_submit.')},
    output,
    async execute({review_id},exec) {
      const caller=await author(exec)
      const state=await queue.read()
      const rows=state.rows.filter(row=>caller.master || row.leadId===caller.id)
      if(!review_id) return JSON.stringify(rows.slice(0,25).map(header))
      const row=rows.find(item=>item.id===review_id)
      if(!row) throw new Error('Review not found.')
      const fixerJob=row.fixerJob ? {
        ...row.fixerJob,
        ...(row.fixerJob.state==='sent' && {agentStatus:ctx.agents.get(row.fixerJob.sessionId)?.status || 'closed'}),
      } : null
      return JSON.stringify({...header(row),result:row.result,error:row.error,delivery:row.delivery,fixerJob,
        current:await queue.tip(row.id,exec.signal),messages:row.messages?.slice(-12)})
    },
  }))
  ctx.tools.register(defineTool({
    name:'auditor_message',
    description:'Ask Auto Auditor a review-specific question or discuss its findings. The answer arrives in this Harness chat as a follow-up. Master Control may message about any review.',
    parameters:{review_id:parameter('Review ID returned by auditor_submit.',true),message:parameter('Question or reply about the review.',true)},
    output,
    async execute({review_id,message},exec) {
      return JSON.stringify(await queue.sendMessage(review_id,await author(exec),message))
    },
  }))
  ctx.connection.register(ctx,channel,async(method,args={},signal,peer)=>{
    if(peer?.principal?.kind!=='owner') return {ok:false,error:{code:'forbidden',message:'Owner access required.',details:{}}}
    try {
      let value
      if(method==='list' || method==='count') {
        const state=await queue.read()
        const pending=state.rows.reduce((count,row)=>count+Number(['queued','reviewing'].includes(row.status))+
          (row.messages ?? []).filter(message=>['queued','answering'].includes(message.status)).length,0)
        value=method==='count' ? pending : {model:state.model,pending,rows:state.rows.map(header)}
      } else if(method==='leads') value=(await leads(signal)).map(({id,title,workspace,cwd})=>({id,title,workspace,cwd}))
      else if(method==='detail') value=await queue.detail(args.id,signal)
      else if(method==='tip') value=await queue.tip(args.id,signal)
      else if(method==='capture') value=await queue.capture(args.id,args.side,signal)
      else if(method==='providers') value=ctx.llm.listProviders().map(({id,name})=>({id,name}))
      else if(method==='models') value=(await ctx.llm.listModels(args.provider)).map(({id,name})=>({id,name}))
      else if(method==='efforts') value=(await ctx.llm.resolveModelInfo(args.provider,args.model,signal)).reasoning ?? null
      else if(method==='settings') value=await queue.selectModel(args)
      else if(method==='fixer-list') value=await queue.fixer.list()
      else if(method==='fixer-start') value=await queue.fixer.start(args.id,signal)
      else if(method==='fixer-model') value=await queue.selectModel(args,'fixerModel')
      else if(method==='fixer-autowake') value=await queue.setAutomaticWake(args.enabled)
      else if(method==='submit') value=await queue.submit(await lead(args.leadId,signal,true),args,false,signal)
      else if(method==='retry') {await queue.retry(args.id);value=true}
      else if(method==='deliver') {await queue.retryDelivery(args.id,args.target);value=true}
      else throw new Error('Unknown Auto Auditor action.')
      return {ok:true,value}
    } catch(error) {return {ok:false,error:{code:'auto-auditor/error',message:error.message,details:{}}}}
  })
}

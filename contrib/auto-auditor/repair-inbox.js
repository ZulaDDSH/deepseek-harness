import {ownerInstructions} from './pr-owner.js'
import {join} from 'node:path'
import {withFileLock} from '@deepseek-ai/dsh-atomic-write'
import {createUserMessage} from '@deepseek-ai/dsh-llm'
import {prepareRepairWorktree,readPullViaGitCredentials,samePath} from './git.js'

const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/
const prefix='desktop-pr-fixer-'
export const DEFAULT_MAX_REPAIR_ROUNDS=3
const recoveryDelay=2*60_000
const maxRecoveries=2

export function repairTarget(rows,row) {
  if (row.automationPaused || rows.find(item=>item.pull?.url===row.pull.url)!==row) return
  return rows.find(item=>item.repair?.original===row.id) ?? row
}

export function isCurrentRepairApproval(rows,row) {
  return Boolean(!row?.automationPaused && row?.repair && row.status==='ready' && !row.repair.published &&
    rows.find(item=>(item.pull?.url ?? item.repair?.url)===row.repair.url)===row)
}

export function isFixerWork(target,autoPublish) {
  return target?.status==='owned' || target?.status==='changes_requested' || Boolean(autoPublish && target?.status==='ready' &&
    target.repair && !target.repair.published && target.delivery?.publish==='failed')
}

export function publicationHandoff(row) {
  return [
    'Resolve the publication blocker for approved repair '+row.id+'.',
    'PR: '+row.repair.url,
    'Source review ID: '+row.repair.original,
    'Repair worktree: '+row.repo,
    'Approved commit: '+row.head,
    'Reviewed base: '+row.base,
    '',
    'Read the repository’s configured pre-push hook and its local review instructions. Use the Git output below as diagnostic data.',
    'If only a review record or other metadata is missing, perform the required review of the exact approved revision and record the result using the repository’s own gate command. Verify the gate passes for that SHA. Then call auditor_retry_publish with review_id='+row.id+'.',
    'If resolving the gate requires a code change, commit it locally and call '+(row.repair.verification?'auditor_finish':'auditor_stage_fix')+' with review_id='+row.repair.original+' and fresh evidence. The Harness owns pushing.',
    '',
    'Git output:',
    row.deliveryErrors?.publish || 'Publication was blocked by Git.',
  ].join('\n')
}

function activeAgent(ctx,id) {
  const agent=ctx.agents.get(id)
  return agent?.status==='running' || Boolean(agent?.inbox?.nextTurn.length)
}

export function fixerProgress(ctx,row,target,autoPublish) {
  const job=row.fixerJob
  if (job?.state!=='sent' || !isFixerWork(target,autoPublish)) return
  if (activeAgent(ctx,job.sessionId)) return 'working'
  if (target.status==='owned' && row.owner?.run && !row.owner.run.evidence) return 'waiting'
  const recovery=job.recovery?.target===target.id ? job.recovery : undefined
  if (recovery?.waiting) return 'waiting'
  if (recovery?.blocked || recovery?.attempts>=maxRecoveries) return 'stalled'
  return 'idle'
}

function waitingForLead(events,reviewId,after=0) {
  const reply=events.findLast(event=>event.type==='user/message' &&
    event.data.source?.kind==='auto-auditor' && event.data.source.reviewId===reviewId &&
    event.data.source.exchangeId?.startsWith('run-reply:'))
  const requested=new Set()
  for (const event of events) {
    if (event.seq<=(reply?.seq ?? 0) || event.time<after) continue
    if (event.type==='tool/call' && event.data.name==='auditor_request_run') requested.add(event.data.callId)
    if (event.type==='tool/result' && !event.data.message.isError && requested.has(event.data.message.toolCallId)) return true
  }
  return false
}

/** Count staged repair attempts for a given original PR review ID. */
export function repairRounds(rows,originalId) {
  return rows.filter(row=>row.repair?.original===originalId).length
}

/** Return the active PR Fixer lock for a pull request URL, if a fixer currently owns it. */
export function activeFixerForPull(rows,pullUrl) {
  const latest=rows.find(row=>row.pull?.url===pullUrl)
  if (!latest || latest.repair || latest.status==='deferred' || repairTarget(rows,latest)?.status==='deferred') return null
  const state=latest.fixerJob?.state
  if (state!=='preparing' && state!=='sent') return null
  if (rows.some(row=>row.repair?.original===latest.id && row.repair.published)) return null
  return {reviewId:latest.id,sessionId:latest.fixerJob.sessionId,state,head:latest.head}
}

/** Project the latest actionable PR findings and earlier jobs with an open chat. */
function inbox(ctx,rows,maxRounds=DEFAULT_MAX_REPAIR_ROUNDS,autoPublish=false) {
  const latest=new Map()
  const repairs=new Map()
  for(const row of rows) {
    if (row.pull && !latest.has(row.pull.url)) latest.set(row.pull.url,row.id)
    if (row.repair && !repairs.has(row.repair.original)) repairs.set(row.repair.original,row)
  }
  return rows.filter(row=>row.pull && !row.repair &&
    (row.fixerJob?.state==='sent' || row.fixerJob?.state==='round_limit' ||
      (latest.get(row.pull.url)===row.id && (row.fixerJob || row.status==='owned' || row.status==='changes_requested')))).map(row=>{
    const repair=repairs.get(row.id)
    const current=latest.get(row.pull.url)===row.id
    const job=row.fixerJob
    const rounds=repairRounds(rows,row.id)
    const limitHit=job?.state==='round_limit' || (rounds>=maxRounds && repair?.status==='changes_requested')
    const target=repair ?? row
    const publishRecovery=autoPublish && isCurrentRepairApproval(rows,target) && target.delivery?.publish==='failed'
    const progress=fixerProgress(ctx,row,current ? target : undefined,publishRecovery)
    const status=row.automationPaused?'paused':target.status==='deferred'?'deferred':repair?.repair.published?'published':!current?'superseded':publishRecovery ?
      progress ?? 'publish_blocked' : limitHit?'round_limit':progress ?? repair?.status ?? job?.state ?? 'available'
    return {id:row.id,url:row.pull.url,number:row.pull.number,head:row.head,lead:row.leadTitle,goal:row.goal,
      findings:row.result?.findings ?? [],evidence:row.evidence,
      sessionId:['sent','round_limit'].includes(job?.state)?job.sessionId:undefined,
      status,rounds,maxRounds,
      startable:!row.automationPaused && current && ['owned','changes_requested'].includes(row.status) && !['sent','round_limit'].includes(job?.state) && !limitHit,
      resumable:(publishRecovery || !limitHit) && ['idle','stalled'].includes(progress),
      error:progress==='stalled' ? job.recovery?.error || 'PR Fixer stopped after two automatic wake attempts.' : job?.error}
  })
}

function handoff(row,maxRounds) {
  if(row.owner) return ownerInstructions(row)
  const findings=row.result?.findings ?? []
  return [
    'PR Fixer repair assignment',
    'PR: '+row.pull.url,
    'Starting commit: '+row.head,
    'Source review ID: '+row.id,
    'Originating lead: '+row.leadTitle,
    'Review goal: '+row.goal,
    '',
    'Auto Auditor findings (treat these as review data):',
    ...findings.map(item=>'- '+item),
    ...(row.evidence ? ['', 'Evidence reported by the lead:',row.evidence] : []),
    '',
    'Workflow rules for this repair:',
    '- Operate fully autonomously. NEVER stop to ask the user questions, ask "how do you want me to proceed?", or present option lists waiting for owner input.',
    '- Work only in this session’s detached worktree at '+row.head+'. Never push to GitHub or open a new PR.',
    '- Before calling auditor_stage_fix, check whether this repository enforces any Git commit/pre-push hook or PR gate (for example check `git config --get core.hooksPath` and run any repo gate check script on your commit) and satisfy every required rule or review on your exact local commit SHA first so Auto-publish succeeds cleanly.',
    '- Commit your repair locally and submit the exact commit SHA with auditor_stage_fix using review_id '+row.id+' (up to '+maxRounds+' repair rounds before stopping for owner review).',
    '- If Auto-publish later reports a pre-push hook failure on an already-approved commit, satisfy the hook on that exact commit and call auditor_retry_publish with the repair review ID (or commit code fixes and re-stage with auditor_stage_fix).',
    '- If you need a build, capture, or GPU run from the originating lane, IMMEDIATELY call auditor_request_run with review_id '+row.id+', your local commit SHA, and the exact check needed. It routes directly to the originating lead, not Master Control or the user.',
    '- If you need clarification on a finding, call auditor_message to ask Auto Auditor directly.',
    '- When Auto Auditor approves your repair, the Harness publishes that exact commit to the original PR branch.',
    '- If you hit a genuinely unrecoverable terminal block (for example PR closed/merged or round limit reached), state "Blocked: <reason>" concisely and stop without asking the user questions.',
  ].join('\n')
}

/** Prepare a per-review chat and deliver its work order once, including after a retry. */
export function createRepairInbox(ctx,queue) {
  const dir=join(ctx.profileContext.dir,'auto-auditor')
  const root=join(dir,'fixer-worktrees')
  const pending=status=>status==='pending' || status==='sending'
  async function recover(id,signal,automatic) {
    return withFileLock(join(dir,'fixer-'+id),async()=>{
      const state=await queue.read()
      const row=state.rows.find(item=>item.id===id && item.pull)
      const job=row?.fixerJob
      const target=row && repairTarget(state.rows,row)
      const publishing=state.fixerAutoPublish && isCurrentRepairApproval(state.rows,target)
      const waitingSince=publishing ? target.created : 0
      if (job?.state!=='sent' || !isFixerWork(target,publishing) ||
          (!publishing && repairRounds(state.rows,id)>=(state.fixerMaxRounds ?? DEFAULT_MAX_REPAIR_ROUNDS)) ||
          (automatic && !state.fixerAutoWake) || activeAgent(ctx,job.sessionId) || pending(target.delivery?.lead)) return false
      if (publishing && pending(target.delivery?.publish_failed)) return false
      const recovery=job.recovery?.target===target.id ? job.recovery : {target:target.id,attempts:0}
      if (automatic && (recovery.blocked || recovery.attempts>=maxRecoveries ||
          Date.now()-Math.max(target.finished ?? target.created,recovery.at ?? 0)<recoveryDelay)) return false
      const save=update=>queue.setFixerRecovery(id,job.sessionId,target.id,{...recovery,...update})
      try {
        if (ctx.workspaceRegistry.archivedSessionIds.includes(job.sessionId)) {
          await save({blocked:true,error:'This repair chat is archived. Restore it before resuming.'})
          return false
        }
        if ((await ctx.waterfall('workspace/session-activity',{sessionId:job.sessionId},async()=>[])).length) return false
        using history=await ctx.sessionQuery.observeSession(job.sessionId,{signal,projectionMode:'none'})
        const lastTurn=history.events.findLast(event=>event.type==='turn/end')
        if (waitingForLead(history.events,id,waitingSince)) {
          if (!recovery.waiting) await save({waiting:true})
          return false
        }
        if (recovery.waiting) await save({waiting:false})
        if (automatic && lastTurn?.data.reason.kind==='aborted') {
          await save({waiting:false,blocked:true,error:'The last PR Fixer turn was cancelled. Resume it when you are ready.'})
          return false
        }
        if (automatic && lastTurn && Date.now()-lastTurn.time<recoveryDelay) return false
        // The fixer may satisfy the hook and stop before it requests another push.
        if (automatic && publishing && target.delivery.publish_failed==='sent' &&
            !target.publishRecheckedAt && Date.now()-(target.publishFailedAt ?? target.finished ?? target.created)>=recoveryDelay &&
            !activeAgent(ctx,job.sessionId) && await queue.recheckPublication(target.id)) return true
        const service=ctx.get('githubReviewStatus')
        let pull
        if (service) {
          try {pull=await service.target(row.pull.url,signal)}
          catch(error) {
            if (!/Connect the PR|Enable the GitHub review status/i.test(error.message)) throw error
          }
        }
        pull ??= await readPullViaGitCredentials(row.pull.url,signal)
        if (pull.prState!=='OPEN' || pull.head!==row.head) {
          await save({blocked:true,error:'The PR closed or its head changed. Review the current PR before resuming.'})
          return false
        }
        const cwd=await prepareRepairWorktree(row,root,join(root,row.owner?.worktreeId || id),signal,{reuseOnly:true})
        if (!await samePath(history.header.cwd,cwd)) throw new Error('The repair chat is bound to a different worktree.')
        const {agent,error}=await ctx.sessionController.resolveAgent(job.sessionId)
        if (!agent || error) throw new Error(error?.message || 'The repair chat could not be reopened.')
        if (!await samePath(agent.session.header.cwd,cwd)) throw new Error('The repair chat is bound to a different worktree.')
        using currentHistory=await ctx.sessionQuery.observeSession(job.sessionId,{signal,projectionMode:'none'})
        const latest=await queue.read()
        const source=latest.rows.find(item=>item.id===id)
        const current=source && repairTarget(latest.rows,source)
        const canResumePublication=latest.fixerAutoPublish && isCurrentRepairApproval(latest.rows,current)
        if (current?.id!==target.id || !isFixerWork(current,canResumePublication) ||
            source.fixerJob?.state!=='sent' || source.fixerJob.sessionId!==job.sessionId ||
            (!publishing && repairRounds(latest.rows,id)>=(latest.fixerMaxRounds ?? DEFAULT_MAX_REPAIR_ROUNDS)) ||
            (automatic && !latest.fixerAutoWake) ||
            activeAgent(ctx,job.sessionId) || pending(current.delivery?.lead) ||
            (publishing && pending(current.delivery?.publish_failed)) ||
            waitingForLead(currentHistory.events,id,waitingSince)) return false
        signal.throwIfAborted()
        const attempt=recovery.attempts+1
        const exchangeId='repair-resume:'+target.id+':'+attempt
        const seen=item=>item.type==='user/message' && item.data.source?.kind==='auto-auditor' &&
          item.data.source.reviewId===id && item.data.source.exchangeId===exchangeId
        if (!currentHistory.events.some(seen)) {
          const text=publishing ? publicationHandoff(current) : row.owner ? ownerInstructions(row) : [
            'Resume PR Fixer work in this existing repair checkout for '+row.pull.url+'.',
            'Inspect git status, local commits, and the prior conversation. Preserve existing work.',
            'Address these current findings and submit the verified local commit using auditor_stage_fix with review_id='+id+'.',
            ...(target.result?.findings ?? []).map(finding=>'- '+finding),
          ].join('\n')
          agent.followup(createUserMessage({content:[{type:'text',text}],source:{
            kind:'auto-auditor',form:'notice',summary:'Resume PR Fixer',reviewId:id,exchangeId,
          }}))
        }
        if (!await ctx.sessions.flush(agent.session)) throw new Error('Could not confirm the resume message was saved.')
        await save({attempts:attempt,at:Date.now(),waiting:false,blocked:false,error:null})
        return true
      } catch(error) {
        if (signal.aborted) return false
        await save({attempts:recovery.attempts+1,at:Date.now(),waiting:false,error:String(error.message).slice(0,800)})
        if (!automatic) throw error
        return false
      }
    },{signal})
  }
  return {
    async supervise(signal) {
      const state=await queue.read()
      if (!state.fixerAutoWake) return
      for (const row of state.rows) {
        signal.throwIfAborted()
        if(row.automationPaused) continue
        const failedDelivery=row.owner && ['fixer','owner_run','owner_reply'].find(key=>row.delivery?.[key]==='failed')
        if(failedDelivery && row.status==='owned' && repairTarget(state.rows,row)===row) {
          await queue.retryOwnerHandoff(row.id,failedDelivery)
          continue
        }
        if (!row.pull || row.fixerJob?.state!=='sent') continue
        const target=repairTarget(state.rows,row)
        const publishing=state.fixerAutoPublish && isCurrentRepairApproval(state.rows,target)
        const progress=fixerProgress(ctx,row,target,publishing)
        if(row.owner && publishing && progress==='stalled') {
          await queue.deferPublication(target.id,target.deliveryErrors?.publish || 'The publication gate is still blocked after automatic recovery.')
          continue
        }
        if(row.owner?.run && target===row && row.status==='owned' && !row.owner.run.evidence &&
            Date.now()-row.owner.run.requestedAt>=24*60*60_000 && !activeAgent(ctx,row.fixerJob.sessionId)) {
          await queue.expireRun(row.id)
          continue
        }
        if(row.owner && target===row && progress==='stalled') {
          await queue.deferOwner(row.id,row.fixerJob.recovery?.error || 'The PR owner stopped after two automatic resumes.')
          continue
        }
        if (['idle','waiting'].includes(progress) && await recover(row.id,signal,true)) return
      }
    },
    async resume(id,signal) {
      if(typeof id!=='string' || !uuid.test(id)) throw new Error('Choose an Auto Auditor review.')
      if (await recover(id,signal,false)) return true
      const state=await queue.read()
      const item=inbox(ctx,state.rows,state.fixerMaxRounds,state.fixerAutoPublish).find(row=>row.id===id)
      throw new Error(item?.error || 'PR Fixer cannot resume this review. Check its current status and any pending lead work.')
    },
    async list() {
      const state=await queue.read()
      const maxRepairRounds=state.fixerMaxRounds ?? DEFAULT_MAX_REPAIR_ROUNDS
      return {
        rows:inbox(ctx,state.rows,maxRepairRounds,state.fixerAutoPublish),
        model:state.fixerModel ?? null,
        automaticWake:state.fixerAutoWake===true,
        autoPublish:state.fixerAutoPublish===true,
        maxRepairRounds,
      }
    },
    async start(id,signal) {
      if(typeof id!=='string' || !uuid.test(id)) throw new Error('Choose an Auto Auditor review.')
      return withFileLock(join(dir,'fixer-'+id),async()=>{
        const state=await queue.read()
        const maxRounds=state.fixerMaxRounds ?? DEFAULT_MAX_REPAIR_ROUNDS
        const item=inbox(ctx,state.rows,maxRounds,state.fixerAutoPublish).find(entry=>entry.id===id)
        if(item?.status==='paused') throw new Error('This historical review is paused.')
        if (item?.sessionId && item.status!=='superseded') return item
        if (!item?.startable) throw new Error('This PR review is no longer available for repair.')
        const row=state.rows.find(entry=>entry.id===id)
        const sessionId=prefix+(row.owner?.worktreeId || id)
        const cwd=join(root,row.owner?.worktreeId || id)
        const rawModel=row.owner ? row.model : state.fixerModel ?? row.model
        if (!rawModel?.provider || !rawModel.model)
          throw new Error('Choose a Fixer model in PR Fixer before starting this repair.')
        const model={provider:rawModel.provider,model:rawModel.model,
          ...(rawModel.reasoningEffort && {reasoningEffort:rawModel.reasoningEffort})}
        await ctx.llm.resolveCallConfig(model,signal)
        const job={sessionId,state:'preparing',model}
        await queue.setFixerJob(id,job)
        try {
          if (ctx.workspaceRegistry.archivedSessionIds.includes(sessionId))
            throw new Error('This repair chat is archived. Restore it to continue the handoff.')
          const worktree=await prepareRepairWorktree(row,root,cwd,signal)
          const existing=(await ctx.sessionController.list({},signal)).items.find(entry=>entry.sessionId===sessionId)
          if (existing && !await samePath(existing.cwd,worktree))
            throw new Error('The repair chat is bound to a different working directory.')
          if (!existing) {
            await ctx.sessionController.create({sessionId,cwd:worktree})
            await ctx.sessionController.rename({sessionId,title:(row.owner?'Auto Auditor · #':'PR Fixer · #')+row.pull.number})
          } else if (!existing.projections?.values?.title) {
            await ctx.sessionController.rename({sessionId,title:(row.owner?'Auto Auditor · #':'PR Fixer · #')+row.pull.number})
          }
          const {agent,error}=await ctx.sessionController.resolveAgent(sessionId)
          if (!agent || error) throw new Error(error?.message || 'Could not open the repair chat.')
          signal?.throwIfAborted()
          if (ctx.permissionPresets.current(agent.session)!=='danger-full-access')
            ctx.permissionPresets.set(agent.session,'danger-full-access')
          const seen=source=>source?.kind==='auto-auditor' && source.reviewId===id && source.exchangeId==='repair-handoff'
          using history=await ctx.sessionQuery.observeSession(sessionId,{signal,projectionMode:'none'})
          if (!agent.inbox.nextTurn.some(entry=>seen(entry.source)) &&
              !history.events.some(event=>event.type==='user/message' && seen(event.data.source))) {
            agent.model.select(model)
            agent.followup(createUserMessage({content:[{type:'text',text:handoff(row,maxRounds)}],source:{
              kind:'auto-auditor',form:'notice',summary:'PR Fixer handoff',reviewId:id,exchangeId:'repair-handoff',
            }}))
          }
          if (!await ctx.sessions.flush(agent.session)) throw new Error('Could not confirm the work order was saved.')
          await queue.setFixerJob(id,{...job,state:'sent'})
        } catch(error) {
          await queue.setFixerJob(id,{...job,state:'handoff_failed',error:String(error.message).slice(0,800)})
          throw error
        }
        const refreshed=await queue.read()
        return inbox(ctx,refreshed.rows,refreshed.fixerMaxRounds,refreshed.fixerAutoPublish).find(entry=>entry.id===id)
      },{signal})
    },
  }
}

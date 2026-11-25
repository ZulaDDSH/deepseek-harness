import {join} from 'node:path'
import {withFileLock} from '@deepseek-ai/dsh-atomic-write'
import {createUserMessage} from '@deepseek-ai/dsh-llm'
import {prepareRepairWorktree,samePath} from './git.js'

const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/
const prefix='desktop-pr-fixer-'

/** Project the latest actionable PR findings and earlier jobs with an open chat. */
function inbox(rows) {
  const latest=new Map()
  const repairs=new Map()
  for(const row of rows) {
    if (row.pull && !latest.has(row.pull.url)) latest.set(row.pull.url,row.id)
    if (row.repair && !repairs.has(row.repair.original)) repairs.set(row.repair.original,row)
  }
  return rows.filter(row=>row.pull && !row.repair &&
    (row.fixerJob?.state==='sent' ||
      (latest.get(row.pull.url)===row.id && (row.fixerJob || row.status==='changes_requested')))).map(row=>{
    const repair=repairs.get(row.id)
    const current=latest.get(row.pull.url)===row.id
    const job=row.fixerJob
    return {id:row.id,url:row.pull.url,number:row.pull.number,head:row.head,lead:row.leadTitle,goal:row.goal,
      findings:row.result?.findings ?? [],evidence:row.evidence,sessionId:job?.state==='sent'?job.sessionId:undefined,
      status:repair?.repair.published?'published':!current?'superseded':repair?.status ?? job?.state ?? 'available',
      startable:current && row.status==='changes_requested' && job?.state!=='sent',
      error:job?.error}
  })
}

function handoff(row) {
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
    'Repair these findings in this session’s worktree, run the relevant tests, and commit the fix locally.',
    'Submit your exact repair commit with auditor_stage_fix using review_id '+row.id+'. Master Control owns publication to the original PR branch.',
  ].join('\n')
}

/** Prepare a per-review chat and deliver its work order once, including after a retry. */
export function createRepairInbox(ctx,queue) {
  const dir=join(ctx.profileContext.dir,'auto-auditor')
  const root=join(dir,'fixer-worktrees')
  return {
    async list() {
      const state=await queue.read()
      return {rows:inbox(state.rows),model:state.fixerModel ?? null,automaticWake:state.fixerAutoWake===true}
    },
    async start(id,signal) {
      if(typeof id!=='string' || !uuid.test(id)) throw new Error('Choose an Auto Auditor review.')
      return withFileLock(join(dir,'fixer-'+id),async()=>{
        const {rows,fixerModel}=await queue.read()
        const item=inbox(rows).find(entry=>entry.id===id)
        if (item?.sessionId) return item
        if (!item?.startable) throw new Error('This PR review is no longer available for repair.')
        const row=rows.find(entry=>entry.id===id)
        const sessionId=prefix+id
        const cwd=join(root,id)
        const rawModel=fixerModel ?? row.model
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
            await ctx.sessionController.rename({sessionId,title:'PR Fixer · #'+row.pull.number})
          } else if (!existing.projections?.values?.title) {
            await ctx.sessionController.rename({sessionId,title:'PR Fixer · #'+row.pull.number})
          }
          const {agent,error}=await ctx.sessionController.resolveAgent(sessionId)
          if (!agent || error) throw new Error(error?.message || 'Could not open the repair chat.')
          signal?.throwIfAborted()
          const seen=source=>source?.kind==='auto-auditor' && source.reviewId===id && source.exchangeId==='repair-handoff'
          using history=await ctx.sessionQuery.observeSession(sessionId,{signal,projectionMode:'none'})
          if (!agent.inbox.nextTurn.some(entry=>seen(entry.source)) &&
              !history.events.some(event=>event.type==='user/message' && seen(event.data.source))) {
            agent.model.select(model)
            agent.followup(createUserMessage({content:[{type:'text',text:handoff(row)}],source:{
              kind:'auto-auditor',form:'notice',summary:'PR Fixer handoff',reviewId:id,exchangeId:'repair-handoff',
            }}))
          }
          if (!await ctx.sessions.flush(agent.session)) throw new Error('Could not confirm the work order was saved.')
          await queue.setFixerJob(id,{...job,state:'sent'})
        } catch(error) {
          await queue.setFixerJob(id,{...job,state:'handoff_failed',error:String(error.message).slice(0,800)})
          throw error
        }
        return inbox((await queue.read()).rows).find(entry=>entry.id===id)
      },{signal})
    },
  }
}

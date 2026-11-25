import {createUserMessage} from '@deepseek-ai/dsh-llm'

const sectionName='auto-auditor-awareness'
const maxSummaryRows=12

function formatModel(selection,fallback) {
  if (!selection?.provider || !selection?.model) return fallback
  return selection.provider+'/'+selection.model+(selection.reasoningEffort?' ('+selection.reasoningEffort+')':'')
}

function pendingCount(rows) {
  return rows.reduce((count,row)=>count+Number(['queued','reviewing'].includes(row.status))+
    (row.messages ?? []).filter(message=>['queued','answering'].includes(message.status)).length,0)
}

function latestReviews(rows) {
  const seen=new Set()
  const result=[]
  for (const row of rows) {
    const key=row.pull?.url || JSON.stringify([row.leadId,row.repair?.url || row.branch || row.id])
    if (seen.has(key)) continue
    seen.add(key)
    result.push(row)
    if (result.length>=maxSummaryRows) break
  }
  return result
}

/** Build the structured Auto Auditor and PR Fixer status snapshot for Master Control. */
export async function buildFixerOverview(ctx,queue) {
  const [state,fixer]=await Promise.all([queue.read(),queue.fixer.list()])
  const rows=state.rows ?? []
  const inbox=fixer.rows.map(item=>({
    ...item,
    ...(item.sessionId && {agentStatus:ctx.agents.get(item.sessionId)?.status || 'closed'}),
  }))
  return {
    reviewerModel:state.model ?? null,
    pendingAudits:pendingCount(rows),
    fixerModel:fixer.model,
    automaticWake:fixer.automaticWake,
    inbox,
    latestReviews:latestReviews(rows),
  }
}

function renderSnapshot(overview) {
  const lines=[
    'Auto Auditor & PR Fixer live state (sidebar tabs Auto Auditor and PR Fixer, plus Master Control Review queue):',
    'PR Fixer is a per-review repair inbox directly below Auto Auditor — not a single standing fixer session. Each started repair creates its own desktop-pr-fixer-<review-id> chat in an isolated detached Git worktree at the exact reviewed PR head. Started fixer chats also appear in mc_list_sessions and can be read or messaged with mc_read_session / mc_send.',
    'Tools: auditor_status (reviews/verdicts), auditor_fixer_status (repair inbox & settings), auditor_send_to_fixer (start PR Fixer for a review), auditor_stage_fix (audit a local repair commit), auditor_publish_fix (publish approved repair with exact lease), auditor_push_and_review, auditor_submit, auditor_message.',
    '',
    'Settings: Reviewer model='+formatModel(overview.reviewerModel,'inherit lead model')+
      ' | Fixer model='+formatModel(overview.fixerModel,'inherit audit model')+
      ' | Automatic wake='+(overview.automaticWake?'on':'off')+
      ' | Pending audits/replies='+overview.pendingAudits,
  ]
  if (overview.latestReviews.length) {
    lines.push('Latest reviews (review_id · target · status · head · lead):')
    for (const row of overview.latestReviews) {
      const target=row.pull ? 'PR #'+row.pull.number : row.repair ? 'Repair PR ('+row.repair.url.split('/').pop()+')' : (row.branch || 'detached')
      const fixerNote=row.fixerJob?.state==='sent' ? ' · fixer='+row.fixerJob.sessionId : row.fixerJob?.state ? ' · fixer='+row.fixerJob.state : ''
      lines.push('- '+row.id+' · '+target+' · '+row.status+' · '+row.head.slice(0,8)+' · '+row.leadTitle+fixerNote)
    }
  } else {
    lines.push('Latest reviews: none')
  }
  if (overview.inbox.length) {
    lines.push('PR Fixer repair inbox (review_id · PR · status · startable · session):')
    for (const item of overview.inbox.slice(0,maxSummaryRows)) {
      const session=item.sessionId ? item.sessionId+' ('+item.agentStatus+')' : item.startable ? 'not started' : 'none'
      const err=item.error ? ' · error='+item.error : ''
      lines.push('- '+item.id+' · PR #'+item.number+' · '+item.status+' · startable='+item.startable+' · '+session+err)
    }
  } else {
    lines.push('PR Fixer repair inbox: empty')
  }
  return lines.join('\n')
}

async function lastInjected(ctx,sessionId,signal) {
  using history=await ctx.sessionQuery.observeSession(sessionId,{signal,projectionMode:'none'})
  const prior=history.events.findLast(event=>
    event.type==='user/message' &&
    event.data.source?.kind==='auto-auditor' &&
    event.data.source?.form==='snapshot' &&
    event.data.source?.sections?.some(section=>section.name===sectionName))
  const block=prior?.data.content?.find(item=>item.type==='text')
  return block?.text ?? null
}

/** Inject change-deduplicated Auto Auditor and PR Fixer awareness into Master Control turns. */
export function registerMasterAwareness(ctx,{queue,isMaster}) {
  ctx.on('agent/pre-step',async({agent,step,signal},next)=>{
    const decision=await next()
    if (decision.kind==='reject' || signal.aborted || step!==1 || !isMaster(agent)) return decision
    try {
      const overview=await buildFixerOverview(ctx,queue)
      const text=renderSnapshot(overview)
      if (signal.aborted) return decision
      const previous=await lastInjected(ctx,agent.id,signal)
      if (signal.aborted || previous===text) return decision
      return {
        ...decision,
        messages:[
          createUserMessage({
            content:[{type:'text',text}],
            source:{kind:'auto-auditor',form:'snapshot',sections:[{name:sectionName,text}]},
          }),
          ...decision.messages,
        ],
      }
    } catch (error) {
      if (!signal.aborted) ctx.logger.warn('Auto Auditor master awareness failed: '+error.message)
      return decision
    }
  },{prepend:true})
}

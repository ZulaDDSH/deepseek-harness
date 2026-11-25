import {createUserMessage} from '@deepseek-ai/dsh-llm'

const masterSectionName='auto-auditor-awareness'
const leadSectionName='pr-workflow-contract'
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
    autoPublish:fixer.autoPublish,
    maxRepairRounds:fixer.maxRepairRounds,
    inbox,
    latestReviews:latestReviews(rows),
  }
}

function renderMasterSnapshot(overview) {
  const lines=[
    'Auto Auditor & PR Fixer live state (sidebar tabs Auto Auditor and PR Fixer, plus Master Control Review queue):',
    'Workflow: Master Control is OUT of the routine PR audit/repair/publish loop. Focus on Nolan’s goals, leads, and system/GPU jobs. Leads open PRs only for important changes (auditor_open_and_review / auditor_push_and_review), Auto Auditor reviews, PR Fixer repairs automatically in per-review detached worktrees (not a standing session), Harness auto-publishes approved repairs to the original PR when Auto-publish is on, needs_run and fixer run requests route directly to the originating lead, and Nolan decides every merge. Intervene in PRs only if Nolan asks or a review hits round_limit / failure escalation.',
    'Tools (inspection/fallback): auditor_status, auditor_fixer_status, auditor_send_to_fixer, auditor_stage_fix, auditor_publish_fix, auditor_push_and_review, auditor_open_and_review, auditor_reply_fixer, auditor_submit, auditor_message.',
    '',
    'Settings: Reviewer model='+formatModel(overview.reviewerModel,'inherit lead model')+
      ' | Fixer model='+formatModel(overview.fixerModel,'inherit audit model')+
      ' | Automatic wake='+(overview.automaticWake?'on':'off')+
      ' | Auto-publish='+(overview.autoPublish?'on':'off')+
      ' | Max repair rounds='+overview.maxRepairRounds+
      ' | Pending audits/replies='+overview.pendingAudits,
  ]
  if (overview.latestReviews.length) {
    lines.push('Latest reviews (review_id · target · status · head · lead):')
    for (const row of overview.latestReviews) {
      const target=row.pull ? 'PR #'+row.pull.number : row.repair ? 'Repair PR #'+row.repair.url.split('/').pop() : (row.branch || 'detached')
      const fixerNote=row.fixerJob?.state==='sent' ? ' · fixer='+row.fixerJob.sessionId : row.fixerJob?.state ? ' · fixer='+row.fixerJob.state : ''
      lines.push('- '+row.id+' · '+target+' · '+row.status+' · '+row.head.slice(0,8)+' · '+row.leadTitle+fixerNote)
    }
  } else {
    lines.push('Latest reviews: none')
  }
  if (overview.inbox.length) {
    lines.push('PR Fixer repair inbox (review_id · PR · status · rounds · startable · session):')
    for (const item of overview.inbox.slice(0,maxSummaryRows)) {
      const session=item.sessionId ? item.sessionId+' ('+item.agentStatus+')' : item.startable ? 'not started' : 'none'
      const err=item.error ? ' · error='+item.error : ''
      lines.push('- '+item.id+' · PR #'+item.number+' · '+item.status+' · rounds='+item.rounds+'/'+item.maxRounds+' · startable='+item.startable+' · '+session+err)
    }
  } else {
    lines.push('PR Fixer repair inbox: empty')
  }
  return lines.join('\n')
}

function renderLeadContract(maxRounds) {
  return [
    'Harness PR workflow (enforced by Auto Auditor & PR Fixer):',
    '- Open a pull request only when you believe the change is necessary or important — not for every minor change.',
    '- Use auditor_open_and_review to push a branch, open a draft PR, and queue Auto Auditor in one step. Use auditor_push_and_review to push a new commit to an existing open PR and audit it. Never push unaudited fixes onto an audited PR branch or open a second PR / side-branch PR for audit fixes.',
    '- When Auto Auditor requests changes on a PR, PR Fixer repairs it automatically in an isolated worktree (up to '+maxRounds+' rounds) and Harness publishes the approved repair back to the original PR. Do not push to a PR while PR Fixer is active on it. Local-branch reviews (with no PR yet) stay with you.',
    '- When Auto Auditor requests a run (needs_run) or PR Fixer requests evidence (auditor_request_run), run the build/test/render on your lane and return the evidence (auditor_submit with previous for needs_run, or auditor_reply_fixer for PR Fixer).',
    '- After an approved repair is published to your PR, fetch and fast-forward your local checkout to the notified head SHA before making further edits. Nolan decides every merge.',
    '- If any tool call is refused, quote the refusal verbatim and stop — never use workaround pushes.',
  ].join('\n')
}

async function lastInjected(ctx,sessionId,sectionName,signal) {
  using history=await ctx.sessionQuery.observeSession(sessionId,{signal,projectionMode:'none'})
  const prior=history.events.findLast(event=>
    event.type==='user/message' &&
    event.data.source?.kind==='auto-auditor' &&
    event.data.source?.form==='snapshot' &&
    event.data.source?.sections?.some(section=>section.name===sectionName))
  const block=prior?.data.content?.find(item=>item.type==='text')
  return block?.text ?? null
}

/** Inject change-deduplicated Auto Auditor/PR Fixer state into Master Control and the PR workflow contract into lead chats. */
export function registerWorkflowAwareness(ctx,{queue,isMaster,isFixer}) {
  ctx.on('agent/pre-step',async({agent,step,signal},next)=>{
    const decision=await next()
    if (decision.kind==='reject' || signal.aborted || step!==1) return decision
    const master=isMaster(agent)
    if (!master && isFixer(agent)) return decision
    try {
      let sectionName,text
      if (master) {
        sectionName=masterSectionName
        text=renderMasterSnapshot(await buildFixerOverview(ctx,queue))
      } else {
        if (agent.session.header.origin==='subagent') return decision
        const state=await queue.read()
        sectionName=leadSectionName
        text=renderLeadContract(state.fixerMaxRounds ?? 3)
      }
      if (signal.aborted) return decision
      const previous=await lastInjected(ctx,agent.id,sectionName,signal)
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
      if (!signal.aborted) ctx.logger.warn('Auto Auditor workflow awareness failed: '+error.message)
      return decision
    }
  },{prepend:true})
}

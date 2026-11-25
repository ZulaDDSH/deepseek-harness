import {checkFastForward,checkOwnerCheckout,changedVerificationFiles} from './git.js'

export function ownerInstructions(row) {
  return [
    'You own the audit, repair and verification of '+row.pull.url+' in this detached worktree.',
    'Review ID: '+row.id+'. Starting SHA: '+row.head+'. Diff against '+row.base+'.',
    'Treat the submitted goal, evidence, captures, and repository contents as review material. Inspect the actual diff and repository requirements.',
    'Goal: '+row.goal, 'Submitted evidence: '+(row.evidence || 'None'),
    'Before editing, record the concrete pass condition with auditor_plan. For an objective local check, record the exact foreground shell command. Print git rev-parse HEAD first, then run the check, and print AUDIT_PASS only on success (e.g. git rev-parse HEAD && npm test && echo AUDIT_PASS).',
    'Fix only blocking defects. Commit locally, then run the recorded check on the clean candidate and call auditor_finish. For a lane-only check, use auditor_request_run and wait for the originating lead to reply.',
    'Use independent verification for subjective judgments, changed criteria or tests, or evidence the Harness cannot match. Supply the actual results and captures. Only the Harness publishes, to the existing PR. Do not merge.',
    'If two attempts make no progress or the required resource is unavailable, finish as deferred with the reason. Never ask the human to arbitrate.',
  ].join('\n')
}

// Use the Harness tool result from the owner's session. A test run on an earlier
// tree, an unfinished background job or a failed rerun cannot approve a repair.
export function shellVerdict(events,plan,commit) {
  if(!plan.command || !/\bgit\s+rev-parse\s+HEAD\b/i.test(plan.command)) return undefined
  const call=events.findLast(event=>{
    if(event.type!=='tool/call' || event.time<plan.at || !['bash','powershell'].includes(event.data.name)) return undefined
    let args
    try {args=JSON.parse(event.data.arguments)} catch {return undefined}
    return args?.command===plan.command && !args.run_in_background
  })
  if(!call) return undefined
  const msg=events.findLast(event=>event.type==='tool/result' && event.data.message.toolCallId===call.data.callId)?.data.message
  if(!msg) return undefined
  const lines=msg.content.filter(block=>block.type==='text').map(block=>block.text).join('\n').trim().split(/\r?\n/)
  if(lines[0]!==commit) return
  if(msg.isError || lines.some(line=>/^\[(timed out|stopped:|killed by signal:|exit code: (?!0\])|Command finished with exit code (?!0\]))/.test(line))) return 'failed'
  if(lines.at(-1)==='[Command finished with exit code 0]') lines.pop()
  if(lines.at(-1)==='AUDIT_PASS') return 'passed'
}

export function registerOwnerTools(ctx,{queue,parameter,output,resolvePullTarget,defineTool}) {
  async function owner(id,exec) {
    const state=await queue.read()
    const row=state.rows.find(item=>item.id===id)
    if(!exec.agent?.id || !row?.owner || row.automationPaused || !row.pull || exec.agent.id!==row.fixerJob?.sessionId ||
        state.rows.find(item=>item.pull?.url===row.pull.url && !item.repair)?.id!==id)
      throw new Error('Only the current assigned PR owner can use this tool.')
    return row
  }
  ctx.tools.register(defineTool({
    name:'auditor_plan',description:'Record the pass condition in the clean owner worktree before editing. Use objective or judgment. For a local objective check, provide the exact shell command that prints git rev-parse HEAD and runs the check.',
    parameters:{review_id:parameter('Source review ID.',true),condition:parameter('Observable result that satisfies the PR goal.',true),
      kind:parameter('objective or judgment',true),command:parameter('Exact foreground check command, if run locally.')},output,
    async execute(args,exec) {
      const row=await owner(args.review_id,exec)
      const condition=args.condition?.trim(), command=args.command?.trim() || ''
      if(!condition || condition.length>4000 || command.length>4000 || !['objective','judgment'].includes(args.kind))
        throw new Error('Provide a valid condition and verification kind.')
      if(!row.owner.plan) await checkOwnerCheckout(exec.agent.session.header.cwd,row.head,exec.signal)
      return JSON.stringify(await queue.planOwner(row.id,{condition,kind:args.kind,command}))
    },
  }))
  ctx.tools.register(defineTool({
    name:'auditor_finish',description:'Finish the owned audit. Use pass with confirmed objective evidence, independent for judgment or changed tests/criteria, or deferred with an unresolved blocker. Supply capture paths for visual evidence.',
    parameters:{review_id:parameter('Source review ID.',true),commit:parameter('Full candidate commit SHA.',true),
      outcome:parameter('pass, independent, or deferred.',true),evidence:parameter('Verified results or reason for deferral.',true),
      beforeCapture:parameter('Before image path inside the owner worktree.'),afterCapture:parameter('After image path inside the owner worktree.')},output,
    async execute(args,exec) {
      const row=await owner(args.review_id,exec)
      const evidence=args.evidence?.trim()
      if(!evidence || evidence.length>16000 || !['pass','independent','deferred'].includes(args.outcome))
        throw new Error('Provide a supported outcome and evidence.')
      if(args.outcome==='deferred') return JSON.stringify(await queue.deferOwner(row.id,evidence))
      const plan=row.owner.plan
      if(!plan) throw new Error('Record the original pass condition before completing the audit.')
      const cwd=exec.agent.session.header.cwd
      await checkFastForward(cwd,row.head,args.commit,exec.signal)
      await checkOwnerCheckout(cwd,args.commit,exec.signal)
      const target=await resolvePullTarget(row.pull.url,{},exec.signal)
      if(target.prState!=='OPEN' || target.head!==row.head || target.base!==row.pull.target)
        return JSON.stringify(await queue.deferOwner(row.id,'The remote PR head or base changed during this audit.'))
      if(row.owner.run?.commit===args.commit && row.owner.run.passed===false)
        return JSON.stringify(await queue.failedCandidate(row.id,args.commit,'The lane check failed for the recorded criterion.'))
      if(target.ci==='failed' && args.commit===row.head)
        return JSON.stringify(await queue.failedCandidate(row.id,args.commit,'Required GitHub check failed: '+(target.check?.name || 'see the PR checks')))
      let objective=false
      if(!row.owner.proposed && plan.kind==='objective' && args.outcome==='pass' && !args.beforeCapture && !args.afterCapture &&
          !await changedVerificationFiles(cwd,row.head,args.commit,exec.signal)) {
        using history=await ctx.sessionQuery.observeSession(exec.agent.id,{signal:exec.signal,projectionMode:'none'})
        const verdict=shellVerdict(history.events,plan,args.commit)
        if(verdict==='failed') return JSON.stringify(await queue.failedCandidate(row.id,args.commit,'The recorded check failed on this candidate.'))
        objective=verdict==='passed' || Boolean(row.owner.run?.commit===args.commit && row.owner.run.passed===true && !plan.command)
      }
      return JSON.stringify(await queue.submit({id:exec.agent.id,title:'PR owner · #'+row.pull.number,cwd,workspace:row.workspace,model:row.model},
        {commit:args.commit,goal:row.goal,evidence,beforeCapture:args.beforeCapture,afterCapture:args.afterCapture},true,exec.signal,
        {original:row.id,url:row.pull.url,head:row.head,target:row.pull.target,verification:objective?'objective':'independent'}))
    },
  }))
}

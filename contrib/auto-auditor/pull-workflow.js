import {createHash} from 'node:crypto'
import {setTimeout as delay} from 'node:timers/promises'
import {createUserMessage} from '@deepseek-ai/dsh-llm'
import {defineTool} from '@deepseek-ai/dsh-tools'
import {branchState,checkFastForward,openPullForCommit,pushPullCommit,readPullViaGitCredentials} from './git.js'
import {buildFixerOverview} from './master-awareness.js'
import {activeFixerForPull,DEFAULT_MAX_REPAIR_ROUNDS,isCurrentRepairApproval,repairRounds} from './repair-inbox.js'

const sha=/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/

/** Register the full PR workflow: open-and-audit, push-and-audit, fixer inbox/staging, run handoff, and publication. */
export function registerPullTools(ctx,{queue,lead,author,parameter,output}) {
  async function resolvePullTarget(url,{originalRow,allowGitOnly=false}={},signal) {
    const service=ctx.get('githubReviewStatus')
    let primaryError
    if (service) {
      try { return await service.target(url,signal) }
      catch (error) {
        const unconfigured=/Connect the PR|Enable the GitHub review status/i.test(error?.message || '')
        if (!unconfigured) throw error
        primaryError=error
      }
    }
    try { return await readPullViaGitCredentials(url,signal) }
    catch (fallbackError) {
      if (allowGitOnly && originalRow) {
        const state=await branchState(originalRow,signal)
        if (state.kind==='current') {
          return {url:originalRow.pull.url,prState:'OPEN',head:originalRow.head,base:originalRow.pull.target}
        }
        if (state.kind==='pull-changed' || state.kind==='pull-base-changed')
          throw new Error('The PR changed since this review. Submit the current PR for a new audit first.')
      }
      throw primaryError || fallbackError
    }
  }
  function requirePushAccess(exec) {
    if (ctx.permissionPresets.current(exec.agent.session)!=='danger-full-access')
      throw new Error('Publishing a PR branch requires Full access on the invoking session.')
  }
  async function pushAndConfirm(cwd,target,commit,expected,signal,afterPush) {
    const pushing=await pushPullCommit(cwd,target,commit,expected,signal)
    try {
      let latest=await resolvePullTarget(target.url,{},signal)
      // GitHub's PR API can lag behind git push by a few seconds while updating pullRequest.headRefOid.
      if (!pushing.alreadyPushed && latest.prState==='OPEN' && latest.head===expected && commit!==expected) {
        for (const waitMs of [750,1500,2500,3500,5000]) {
          await delay(waitMs,undefined,{signal})
          latest=await resolvePullTarget(target.url,{},signal)
          if (latest.prState!=='OPEN' || latest.head===commit) break
        }
      }
      if (latest.prState!=='OPEN' || latest.head!==commit)
        throw new Error('GitHub has not confirmed this commit as the current open PR head.')
      let audit
      for (let attempt=0; attempt<4; attempt++) {
        try { audit=await afterPush(latest); break }
        catch (error) {
          if (attempt<3 && !pushing.alreadyPushed && /does not match the live PR head/i.test(error?.message || '')) {
            await delay(1000*(attempt+1),undefined,{signal})
            continue
          }
          throw error
        }
      }
      return {status:'submitted',pullRequest:target.url,head:commit,alreadyPushed:pushing.alreadyPushed,audit}
    } catch (error) {
      return {status:'pushed_pending_audit',pullRequest:target.url,head:commit,
        message:error.message,retry:'Retry this action with the same revision.'}
    }
  }
  async function deliverNotice(targetId,{text,summary,reviewId,exchangeId},signal) {
    if (ctx.workspaceRegistry.archivedSessionIds.includes(targetId))
      throw new Error('Recipient session has been archived.')
    const {agent,error}=await ctx.sessionController.resolveAgent(targetId)
    if (!agent || error) throw new Error(error?.message || 'Recipient session is unavailable.')
    signal?.throwIfAborted()
    const seen=source=>source?.kind==='auto-auditor' && source.reviewId===reviewId && source.exchangeId===exchangeId
    using history=await ctx.sessionQuery.observeSession(targetId,{signal,projectionMode:'none'})
    if (!agent.inbox.nextTurn.some(item=>seen(item.source)) &&
        !history.events.some(event=>event.type==='user/message' && seen(event.data.source))) {
      agent.followup(createUserMessage({content:[{type:'text',text}],source:{
        kind:'auto-auditor',form:'notice',summary,reviewId,exchangeId,
      }}))
    }
    if (!await ctx.sessions.flush(agent.session))
      throw new Error('Could not confirm that the handoff message was saved.')
  }
  async function publishApprovedRepair(reviewId,signal) {
    const rows=(await queue.read()).rows
    const repair=rows.find(row=>row.id===reviewId)
    if (!isCurrentRepairApproval(rows,repair))
      throw new Error('Choose the latest approved repair for that PR.')
    const target=await resolvePullTarget(repair.repair.url,{},signal)
    if (target.prState!=='OPEN')
      throw new Error('This pull request is no longer open.')
    const outcome=await pushAndConfirm(repair.repo,target,repair.head,repair.repair.head,signal,
      latest=>{
        if (latest.prState!=='OPEN') throw new Error('This pull request is no longer open.')
        return queue.recordPublishedRepair(repair.id,signal)
      })
    if (outcome.status!=='submitted') throw new Error(outcome.message || 'Could not confirm the published repair on GitHub.')
    return outcome
  }
  queue.setPublisher(publishApprovedRepair)

  ctx.tools.register(defineTool({
    name:'auditor_open_and_review',
    description:'Push a committed local branch, open a GitHub PR (Draft by default) using host Git credentials, and immediately queue that exact commit for Auto Auditor in one idempotent step. Retry a pushed_pending_audit result with the same arguments without opening a duplicate PR.',
    parameters:{
      commit:parameter('Complete SHA of the local commit to publish.',true),
      title:parameter('Pull request title.',true),
      branch:parameter('Local branch name to push. Defaults to the currently checked-out branch.'),
      base:parameter('Target base branch on GitHub (for example main). Defaults to the remote default branch.'),
      body:parameter('Pull request description body.'),
      draft:parameter('Open as a draft pull request ("true" or "false"). Defaults to "true".'),
      remote:parameter('Configured Git push remote. Defaults to origin.'),
      base_remote:parameter('Configured Git remote for the target repository if pushing to a fork. Defaults to remote.'),
      lead_id:parameter('Lead session ID, required when invoking from Master Control.'),
      goal:parameter('Review goal. Defaults to the pull request title.'),
      evidence:parameter('Test results, timings, or reproduction evidence.'),
      beforeCapture:parameter('Path to a before image for visual review.'),
      afterCapture:parameter('Path to an after image for visual review.'),
    },
    output,
    async execute(args,exec) {
      const caller=await author(exec)
      requirePushAccess(exec)
      if (caller.master ? !args.lead_id : args.lead_id && args.lead_id!==caller.id)
        throw new Error('Use the originating lead chat or identify the lead in Master Control.')
      if (!sha.test(args.commit ?? ''))
        throw new Error('Specify the complete commit SHA to publish.')
      const title=typeof args.title==='string' ? args.title.trim() : ''
      if (!title || title.length>256) throw new Error('Enter a pull request title (up to 256 characters).')
      const source=await lead(args.lead_id || caller.id,exec.signal,true)
      const draft=args.draft==='false' ? false : true
      const opened=await openPullForCommit(source.cwd,{
        branch:args.branch,commit:args.commit,base:args.base,title,body:args.body,draft,
        remote:args.remote,baseRemote:args.base_remote,
      },exec.signal)
      const active=activeFixerForPull((await queue.read()).rows,opened.url)
      if (active && !caller.master && active.head!==opened.head)
        throw new Error('PR Fixer is actively repairing this pull request ('+active.sessionId+'). Wait for the repair to finish or escalate before updating it.')
      try {
        const audit=await queue.submit(source,{
          pull_request:opened.url,commit:opened.head,base:opened.base,
          goal:args.goal || title,evidence:args.evidence,
          beforeCapture:args.beforeCapture,afterCapture:args.afterCapture,
        },true,exec.signal)
        return JSON.stringify({
          status:'submitted',pullRequest:opened.url,number:opened.number,head:opened.head,
          draft:opened.draft,alreadyPushed:opened.alreadyPushed,alreadyOpened:opened.alreadyOpened,audit,
        })
      } catch (error) {
        return JSON.stringify({
          status:'pushed_pending_audit',pullRequest:opened.url,number:opened.number,head:opened.head,
          draft:opened.draft,alreadyPushed:opened.alreadyPushed,alreadyOpened:opened.alreadyOpened,
          message:error.message,retry:'Retry this action with the same arguments.',
        })
      }
    },
  }))

  ctx.tools.register(defineTool({
    name:'auditor_fixer_status',
    description:'Master Control only. Inspect the PR Fixer repair inbox, active fixer chat IDs/statuses, Fixer model, Automatic wake, Auto-publish, max repair rounds, and Auto Auditor pending count. PR Fixer is a per-review repair inbox (not a single standing session); Master Control stays out of the routine repair/publish loop unless asked or a review hits the round limit.',
    parameters:{},
    output,
    async execute(_args,exec) {
      if (!(await author(exec)).master) throw new Error('Read the PR Fixer inbox from Master Control.')
      const {reviewerModel,pendingAudits,fixerModel,automaticWake,autoPublish,maxRepairRounds,inbox}=await buildFixerOverview(ctx,queue)
      return JSON.stringify({reviewerModel,pendingAudits,fixerModel,automaticWake,autoPublish,maxRepairRounds,inbox})
    },
  }))

  ctx.tools.register(defineTool({
    name:'auditor_send_to_fixer',
    description:'Master Control fallback tool. Start a per-review PR Fixer chat (desktop-pr-fixer-<review-id>) and isolated detached Git worktree for an Auto Auditor PR that needs changes when Automatic wake is off or needs manual retry.',
    parameters:{review_id:parameter('The Auto Auditor review ID with changes requested.',true)},
    output,
    async execute(args,exec) {
      if (!(await author(exec)).master) throw new Error('Assign a repair from Master Control.')
      return JSON.stringify(await queue.fixer.start(args.review_id,exec.signal))
    },
  }))

  ctx.tools.register(defineTool({
    name:'auditor_push_and_review',
    description:'Push a specific committed revision to an existing open GitHub PR under an exact-head lease and queue that exact commit for Auto Auditor. Refused while PR Fixer is actively repairing that PR. Retry a pushed_pending_audit result with the same arguments.',
    parameters:{pull_request:parameter('Full URL of an existing open GitHub PR.',true),
      expected_head:parameter('Complete SHA of the current PR head before publishing.',true),
      commit:parameter('Complete SHA of the local commit to publish.',true),
      lead_id:parameter('Lead session ID, required when invoking from Master Control.'),
      goal:parameter('Review goal.'),evidence:parameter('Test results or capture evidence.')},
    output,
    async execute(args,exec) {
      const caller=await author(exec)
      requirePushAccess(exec)
      if (caller.master ? !args.lead_id : args.lead_id && args.lead_id!==caller.id)
        throw new Error('Use the originating lead chat or identify the lead in Master Control.')
      if (!sha.test(args.commit ?? '') || !sha.test(args.expected_head ?? ''))
        throw new Error('Specify complete commit SHAs for the expected and proposed PR head.')
      const source=await lead(args.lead_id || caller.id,exec.signal,true)
      const target=await resolvePullTarget(args.pull_request,{},exec.signal)
      const active=activeFixerForPull((await queue.read()).rows,target.url)
      if (active && !caller.master)
        throw new Error('PR Fixer is actively repairing this pull request ('+active.sessionId+'). Wait for the repair to finish or escalate before pushing to this PR.')
      return JSON.stringify(await pushAndConfirm(source.cwd,target,args.commit,args.expected_head,exec.signal,
        latest=>queue.submit(source,{pull_request:latest.url,commit:latest.head,goal:args.goal,evidence:args.evidence},true,exec.signal)))
    },
  }))

  ctx.tools.register(defineTool({
    name:'auditor_stage_fix',
    description:'Queue a local, unpushed repair commit for an existing pull request for Auto Auditor review before publication. While PR Fixer owns a review, only the assigned PR Fixer chat (or Master Control) may stage fixes for it, up to the configured repair round limit.',
    parameters:{review_id:parameter('Original PR review ID whose findings are being fixed.',true),
      commit:parameter('Complete SHA of the local repair commit.',true),
      fixer_id:parameter('PR Fixer or originating lead session ID when invoking from Master Control.'),
      evidence:parameter('Results from testing the proposed fix.')},
    output,
    async execute(args,exec) {
      const caller=await author(exec)
      const state=await queue.read()
      const rows=state.rows
      const original=rows.find(row=>row.id===args.review_id && row.pull)
      const latest=original && rows.find(row=>row.pull?.url===original.pull.url)
      const jobState=original?.fixerJob?.state
      const assigned=jobState==='sent' ? original.fixerJob.sessionId : undefined
      if (!original || original.status!=='changes_requested' || latest?.id!==original.id)
        throw new Error('Choose the latest pull request review with changes requested.')
      const maxRounds=state.fixerMaxRounds ?? DEFAULT_MAX_REPAIR_ROUNDS
      const rounds=repairRounds(rows,original.id)
      if (jobState==='round_limit' || rounds>=maxRounds)
        throw new Error('Repair round limit ('+rounds+'/'+maxRounds+') reached for this review. Stop automatic repairs and wait for owner review or a fresh PR audit.')
      if (!caller.master) {
        if (assigned) {
          if (caller.id!==assigned)
            throw new Error('PR Fixer ('+assigned+') owns repairs for this review. Wait for it to finish rather than staging a competing fix.')
        } else if (caller.id!==original.leadId) {
          throw new Error('Choose a pull request review with changes requested from its assigned fixer, lead, or Master Control.')
        }
        if (args.fixer_id && args.fixer_id!==caller.id)
          throw new Error('Master Control must choose another session’s repair.')
      }
      if (!sha.test(args.commit ?? '') || args.commit===original.head)
        throw new Error('Choose the complete SHA of a new repair commit.')
      const target=await resolvePullTarget(original.pull.url,{originalRow:original,allowGitOnly:true},exec.signal)
      if (target.prState!=='OPEN' || target.head!==original.head)
        throw new Error('The PR changed since this review. Submit the current PR for a new audit first.')
      const fixer=await lead(caller.master ? args.fixer_id || assigned || original.leadId : caller.id,exec.signal,true)
      return JSON.stringify(await queue.submit(fixer,{commit:args.commit,goal:original.goal,evidence:args.evidence},
        true,exec.signal,{original:original.id,url:target.url,head:target.head,target:original.pull.target}))
    },
  }))

  ctx.tools.register(defineTool({
    name:'auditor_request_run',
    description:'PR Fixer tool. Ask the originating lead to run a build, test, capture, or GPU benchmark for a local repair commit under the lead’s lane and job queue. Routes directly to the originating lead, not Master Control.',
    parameters:{
      review_id:parameter('Original PR review ID assigned to this PR Fixer chat.',true),
      commit:parameter('Complete SHA of the local repair commit in this worktree to verify.',true),
      request:parameter('Exact build, test, capture, or benchmark needed from the originating lead.',true),
    },
    output,
    async execute(args,exec) {
      const caller=await author(exec)
      const state=await queue.read()
      const original=state.rows.find(row=>row.id===args.review_id && row.pull)
      const assigned=original?.fixerJob?.state==='sent' ? original.fixerJob.sessionId : undefined
      if (!original || !assigned || (!caller.master && caller.id!==assigned))
        throw new Error('Only the assigned PR Fixer chat can request a lane run for this review.')
      if (!sha.test(args.commit ?? ''))
        throw new Error('Specify the complete SHA of the local repair commit.')
      const request=typeof args.request==='string' ? args.request.trim() : ''
      if (!request || request.length>4000) throw new Error('Describe the run or evidence needed (up to 4000 characters).')
      const fixerSession=await lead(assigned,exec.signal)
      await checkFastForward(fixerSession.cwd,original.head,args.commit,exec.signal)
      const digest=createHash('sha256').update(args.commit+'\n'+request).digest('hex').slice(0,16)
      const text=[
        'PR Fixer requests a lane run for '+original.pull.url,
        'Source review ID: '+original.id,
        'PR Fixer chat: '+assigned,
        'Repair worktree: '+fixerSession.cwd,
        'Repair commit: '+args.commit,
        '',
        'Requested check / evidence:',
        request,
        '',
        'Run this under your lane’s job queue. As soon as the task is done, call auditor_reply_fixer using review_id='+original.id+' with the verified results and the full commit SHA if you made a fix. Send the reply before marking the task complete or picking up other work.',
      ].join('\n')
      await deliverNotice(original.leadId,{
        text,summary:'PR Fixer · Run request',reviewId:original.id,exchangeId:'run-request:'+digest,
      },exec.signal)
      return JSON.stringify({status:'requested',reviewId:original.id,targetLeadId:original.leadId,commit:args.commit})
    },
  }))

  ctx.tools.register(defineTool({
    name:'auditor_reply_fixer',
    description:'Originating lead (or Master Control) tool. Notify the assigned PR Fixer immediately when an assigned audit fix or evidence run is complete. Include the verified result and the full commit SHA for any code changes.',
    parameters:{
      review_id:parameter('Original PR review ID whose PR Fixer requested evidence.',true),
      evidence:parameter('What was completed and the verified test results or remaining blocker.',true),
      commit:parameter('Full commit SHA of a completed fix from the lead’s worktree, when code changed.'),
    },
    output,
    async execute(args,exec) {
      const caller=await author(exec)
      const state=await queue.read()
      const original=state.rows.find(row=>row.id===args.review_id && row.pull)
      const assigned=original?.fixerJob?.state==='sent' ? original.fixerJob.sessionId : undefined
      if (!original || !assigned || (!caller.master && caller.id!==original.leadId))
        throw new Error('Only the originating lead or Master Control can reply to the active PR Fixer for this review.')
      const evidence=typeof args.evidence==='string' ? args.evidence.trim() : ''
      if (!evidence || evidence.length>16000) throw new Error('Enter run evidence (up to 16000 characters).')
      const commit=args.commit
      if (commit!==undefined) {
        if (!sha.test(commit)) throw new Error('Specify the complete SHA of the completed fix.')
        const source=await lead(original.leadId,exec.signal)
        await checkFastForward(source.cwd,commit,commit,exec.signal)
      }
      const digest=createHash('sha256').update(commit ? commit+'\n'+evidence : evidence).digest('hex').slice(0,16)
      const text=[
        'Originating lead '+(commit?'completed audit fix':'audit task results')+' for '+original.pull.url,
        'Source review ID: '+original.id,
        'From: '+(caller.master ? 'Master Control' : original.leadTitle),
        ...(commit ? ['Completed fix commit: '+commit] : []),
        '',
        evidence,
        '',
        commit ? 'Inspect the supplied commit and incorporate the relevant fix before staging the repair with auditor_stage_fix using review_id='+original.id+'.' :
          'Attach this evidence when staging your repair commit with auditor_stage_fix using review_id='+original.id+'.',
      ].join('\n')
      await deliverNotice(assigned,{
        text,summary:commit?'Lead · Audit fix completed':'Lead · Run evidence',reviewId:original.id,exchangeId:'run-reply:'+digest,
      },exec.signal)
      return JSON.stringify({status:'delivered',reviewId:original.id,fixerSessionId:assigned})
    },
  }))

  ctx.tools.register(defineTool({
    name:'auditor_retry_publish',
    description:'PR Fixer (or Master Control) tool. After satisfying a repository pre-push hook or review gate on an already-approved repair commit (without changing the commit SHA), ask Harness to retry Auto-publish for that approved repair review.',
    parameters:{review_id:parameter('Approved repair review ID whose Auto-publish failed.',true)},
    output,
    async execute(args,exec) {
      const caller=await author(exec)
      const state=await queue.read()
      const repair=state.rows.find(row=>row.id===args.review_id)
      if (!isCurrentRepairApproval(state.rows,repair))
        throw new Error('Choose the latest approved, unpublished repair for that PR.')
      const original=state.rows.find(row=>row.id===repair.repair.original)
      const assigned=original?.fixerJob?.sessionId || repair.leadId
      if (!caller.master && caller.id!==repair.leadId && caller.id!==assigned)
        throw new Error('Only the assigned PR Fixer or Master Control can retry Auto-publish for this repair.')
      if (!state.fixerAutoPublish)
        throw new Error('Auto-publish is disabled. Ask Master Control to publish this repair with auditor_publish_fix.')
      if (!['failed','uncertain'].includes(repair.delivery?.publish))
        throw new Error('Auto-publish is not awaiting a retry for this repair.')
      await queue.retryDelivery(repair.id,'publish')
      return JSON.stringify({status:'queued',reviewId:repair.id,pullRequest:repair.repair.url,head:repair.head})
    },
  }))

  ctx.tools.register(defineTool({
    name:'auditor_publish_fix',
    description:'Master Control manual fallback. Publish the exact approved repair commit to its original PR branch under an exact-head lease when Auto-publish is off or needs manual retry.',
    parameters:{review_id:parameter('Approved repair review ID from auditor_stage_fix.',true)},
    output,
    async execute(args,exec) {
      const caller=await author(exec)
      if (!caller.master) throw new Error('Publish an approved repair from Master Control.')
      requirePushAccess(exec)
      const rows=(await queue.read()).rows
      const repair=rows.find(row=>row.id===args.review_id)
      if (!isCurrentRepairApproval(rows,repair))
        throw new Error('Choose the latest approved repair for that PR.')
      const target=await resolvePullTarget(repair.repair.url,{},exec.signal)
      if (target.prState!=='OPEN')
        throw new Error('This pull request is no longer open.')
      return JSON.stringify(await pushAndConfirm(repair.repo,target,repair.head,repair.repair.head,exec.signal,
        latest=>{
          if (latest.prState!=='OPEN') throw new Error('This pull request is no longer open.')
          return queue.recordPublishedRepair(repair.id,exec.signal)
        }))
    },
  }))
}

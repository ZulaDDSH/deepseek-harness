import {defineTool} from '@deepseek-ai/dsh-tools'
import {pushPullCommit} from './git.js'

const sha=/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/

/** Register the workflow for an existing PR and its locally reviewed repairs. */
export function registerPullTools(ctx,{queue,lead,author,parameter,output}) {
  function github() {
    const service=ctx.get('githubReviewStatus')
    if (!service) throw new Error('Enable the GitHub review status plugin.')
    return service
  }
  function requirePushAccess(exec) {
    if (ctx.permissionPresets.current(exec.agent.session)!=='danger-full-access')
      throw new Error('Publishing a PR branch requires Full access on the invoking session.')
  }
  async function pushAndConfirm(cwd,target,commit,expected,signal,afterPush) {
    const pushing=await pushPullCommit(cwd,target,commit,expected,signal)
    try {
      const latest=await github().target(target.url,signal)
      if (latest.prState!=='OPEN' || latest.head!==commit)
        throw new Error('GitHub has not confirmed this commit as the current open PR head.')
      const audit=await afterPush(latest)
      return {status:'submitted',pullRequest:target.url,head:commit,alreadyPushed:pushing.alreadyPushed,audit}
    } catch (error) {
      return {status:'pushed_pending_audit',pullRequest:target.url,head:commit,
        message:error.message,retry:'Retry this action with the same revision.'}
    }
  }
  ctx.tools.register(defineTool({
    name:'auditor_send_to_fixer',
    description:'Master Control only. Start PR Fixer for an Auto Auditor PR that needs changes. PR Fixer gets a dedicated repair worktree and receives the PR URL, exact starting commit, and findings.',
    parameters:{review_id:parameter('The Auto Auditor review ID with changes requested.',true)},
    output,
    async execute(args,exec) {
      if (!(await author(exec)).master) throw new Error('Assign a repair from Master Control.')
      return JSON.stringify(await queue.fixer.start(args.review_id,exec.signal))
    },
  }))
  ctx.tools.register(defineTool({
    name:'auditor_push_and_review',
    description:'When the owner requests publication, push a specific committed revision to an existing GitHub PR and queue that exact commit for audit. Retry a pushed_pending_audit result with the same arguments.',
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
      const target=await github().target(args.pull_request,exec.signal)
      return JSON.stringify(await pushAndConfirm(source.cwd,target,args.commit,args.expected_head,exec.signal,
        latest=>queue.submit(source,{pull_request:latest.url,commit:latest.head,goal:args.goal,evidence:args.evidence},true,exec.signal)))
    },
  }))
  ctx.tools.register(defineTool({
    name:'auditor_stage_fix',
    description:'Queue a local repair for an existing pull request for audit before publication. The originating lead can submit its own fix. Master Control can identify a PR Fixer session and submit its commit.',
    parameters:{review_id:parameter('Original PR review ID whose findings are being fixed.',true),
      commit:parameter('Complete SHA of the local repair commit.',true),
      fixer_id:parameter('PR Fixer or originating lead session ID when invoking from Master Control.'),
      evidence:parameter('Results from testing the proposed fix.')},
    output,
    async execute(args,exec) {
      const caller=await author(exec)
      const rows=(await queue.read()).rows
      const original=rows.find(row=>row.id===args.review_id && row.pull)
      const latest=original && rows.find(row=>row.pull?.url===original.pull.url)
      const assigned=original?.fixerJob?.state==='sent' ? original.fixerJob.sessionId : undefined
      if (!original || original.status!=='changes_requested' || latest?.id!==original.id ||
          (!caller.master && caller.id!==original.leadId && caller.id!==assigned))
        throw new Error('Choose the latest pull request review with changes requested from its assigned fixer, lead, or Master Control.')
      if (!caller.master && args.fixer_id && args.fixer_id!==caller.id)
        throw new Error('Master Control must choose another session’s repair.')
      if (!sha.test(args.commit ?? '') || args.commit===original.head)
        throw new Error('Choose the complete SHA of a new repair commit.')
      const target=await github().target(original.pull.url,exec.signal)
      if (target.prState!=='OPEN' || target.head!==original.head || target.base!==original.pull.target)
        throw new Error('The PR changed since this review. Submit the current PR for a new audit first.')
      const fixer=await lead(caller.master ? args.fixer_id || assigned || original.leadId : caller.id,exec.signal,true)
      return JSON.stringify(await queue.submit(fixer,{commit:args.commit,goal:original.goal,evidence:args.evidence},
        true,exec.signal,{original:original.id,url:target.url,head:target.head,target:target.base}))
    },
  }))
  ctx.tools.register(defineTool({
    name:'auditor_publish_fix',
    description:'Master Control only. After owner authorization, publish the exact approved repair commit to its original PR branch. A different PR head or target requires a fresh audit.',
    parameters:{review_id:parameter('Approved repair review ID from auditor_stage_fix.',true)},
    output,
    async execute(args,exec) {
      const caller=await author(exec)
      if (!caller.master) throw new Error('Publish an approved repair from Master Control.')
      requirePushAccess(exec)
      const rows=(await queue.read()).rows
      const repair=rows.find(row=>row.id===args.review_id)
      if (!repair?.repair || repair.status!=='ready' ||
          rows.find(row=>row.repair?.original===repair.repair.original)?.id!==repair.id)
        throw new Error('Choose the latest approved repair for that PR.')
      const target=await github().target(repair.repair.url,exec.signal)
      if (target.base!==repair.repair.target)
        throw new Error('The target branch changed since the repair audit. Submit a fresh review.')
      return JSON.stringify(await pushAndConfirm(repair.repo,target,repair.head,repair.repair.head,exec.signal,
        latest=>{
          if (latest.base!==repair.repair.target) throw new Error('The target moved during the push. Submit the current PR for a fresh audit.')
          return queue.recordPublishedRepair(repair.id,exec.signal)
        }))
    },
  }))
}

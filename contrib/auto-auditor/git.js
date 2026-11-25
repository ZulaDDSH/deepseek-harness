import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {lstat,mkdir,realpath} from 'node:fs/promises'
import {isAbsolute, relative, resolve, sep} from 'node:path'

const exec = promisify(execFile)
const diffOptions = ['--no-color','--no-ext-diff','--no-textconv','--submodule=short','--no-renames']
const maxDiffBytes = 100_000

async function git(cwd, args, signal, limit = 65536) {
  try {
    const {stdout} = await exec('git', ['--no-optional-locks','--no-replace-objects','-c','core.quotePath=true', ...args], {
      cwd, signal, windowsHide:true, timeout:15000, maxBuffer:limit,
      env:{...process.env,GIT_TERMINAL_PROMPT:'0',GIT_NO_LAZY_FETCH:'1'},
    })
    return stdout
  } catch (error) {
    if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') throw new Error('This diff exceeds the review size limit. Submit a smaller commit range.')
    signal?.throwIfAborted()
    throw new Error(String(error.stderr || 'Unable to read this Git repository.').trim().slice(0,450), {cause:error})
  }
}

function checkedRef(value) {
  if (typeof value !== 'string' || value.length > 256 || !/^[\w][\w./@+-]*$/.test(value) || value.includes('..'))
    throw new Error('Use a branch name, tag, or commit SHA.')
  return value
}
const revision = async (repo, ref, signal) => (await git(repo,['rev-parse','--verify','--end-of-options',ref+'^{commit}'],signal)).trim()
async function optionalRevision(repo, ref, signal) {
  try { return await revision(repo,ref,signal) }
  catch (error) { if (error.cause?.code !== 128) throw error }
}

const githubPath = '[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+'
const githubRemote = new RegExp('^(?:https://github\\.com/|git@github\\.com:|ssh://git@github\\.com/)('+githubPath+')/?$','i')
const githubPR = new RegExp('^https://github\\.com/('+githubPath+')/pull/([1-9]\\d{0,11})/?$','i')
const sha = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/
const headRef = number => 'refs/pull/'+number+'/head'

function remoteRepository(url) {
  return url.match(githubRemote)?.[1].replace(/\.git$/i,'').toLowerCase()
}

async function workspaceRepo(cwd, signal) {
  const folder = await realpath(cwd)
  return realpath((await git(folder,['rev-parse','--show-toplevel'],signal)).trim())
}

/** Verify that both commits are local and that publishing them advances the PR. */
export async function checkFastForward(repo, expectedHead, candidate, signal) {
  if (!sha.test(expectedHead ?? '') || !sha.test(candidate ?? ''))
    throw new Error('Use the complete commit SHA for the current PR head and the proposed change.')
  if (await revision(repo,candidate,signal)!==candidate)
    throw new Error('The proposed revision is not a commit in this workspace.')
  if (expectedHead===candidate) return
  try { await git(repo,['merge-base','--is-ancestor',expectedHead,candidate],signal) }
  catch (error) {
    if (error.cause?.code!==1) throw error
    throw new Error('The proposed commit does not advance the current PR head. Reconcile the branch and submit again.')
  }
}

/** Publish a pinned commit to the verified source branch using an exact ref lease. */
export async function pushPullCommit(cwd,target,candidate,expectedHead,signal) {
  if (target.prState!=='OPEN' || !target.headRepo || !target.headBranch)
    throw new Error('This PR does not have a writable open source branch.')
  const repo=await workspaceRepo(cwd,signal)
  if (target.head===candidate) {
    await checkFastForward(repo,candidate,candidate,signal)
    return {alreadyPushed:true}
  }
  if (target.head!==expectedHead)
    throw new Error('The PR head changed. Reconcile the latest revision before publishing.')
  await checkFastForward(repo,expectedHead,candidate,signal)
  const destination='refs/heads/'+target.headBranch
  await git(repo,['check-ref-format',destination],signal)
  const names=(await git(repo,['remote'],signal)).trim().split(/\r?\n/).filter(name=>/^[\w][\w./-]*$/.test(name))
  for (const remote of names) {
    // Match the configured push destination, including a fork’s separate push URL.
    const urls=await git(repo,['config','--get-all','remote.'+remote+'.pushurl'],signal)
      .catch(error=>{if(error.cause?.code!==1) throw error;return ''})
    const configured=(urls.trim() || await git(repo,['config','--get-all','remote.'+remote+'.url'],signal)).trim().split(/\r?\n/)
    if (configured.length!==1 || remoteRepository(configured[0])!==target.headRepo) continue
    await git(repo,['push','--no-follow-tags','--recurse-submodules=no','--force-with-lease='+destination+':'+expectedHead,
      '--',remote,candidate+':'+destination],signal)
    return {alreadyPushed:false}
  }
  throw new Error('This worktree needs a configured push remote for the PR’s source repository.')
}

/** Compare two existing filesystem paths using canonical targets and platform casing. */
export async function samePath(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || !left || !right) return false
  const canonical = async value => {
    const target = await realpath(value)
    return process.platform === 'win32' ? target.toLowerCase() : target
  }
  try { return await canonical(left) === await canonical(right) }
  catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false
    throw error
  }
}

/** Prepare a detached worktree at the reviewed PR head, preserving an existing retry. */
export async function prepareRepairWorktree(row, root, cwd, signal) {
  const {head}=await pullRefs(row.repo,row.pull,signal)
  if (head!==row.head)
    throw new Error('The PR head has moved. Send the current revision to Auto Auditor before starting a repair.')
  let existing
  try {existing=await lstat(cwd)}
  catch (error) {if(error.code!=='ENOENT') throw error}
  if (existing) {
    if (!existing.isDirectory()) throw new Error('The repair directory is not a regular directory.')
    if (!await samePath(await workspaceRepo(cwd,signal),cwd))
      throw new Error('The existing repair directory is not its own worktree.')
    const common=async path=>resolve(path,(await git(path,['rev-parse','--git-common-dir'],signal)).trim())
    if (!await samePath(await common(cwd),await common(row.repo)))
      throw new Error('The existing repair directory belongs to a different repository.')
    const tip=await revision(cwd,'HEAD',signal)
    await checkFastForward(cwd,row.head,tip,signal)
  } else {
    if (!await optionalRevision(row.repo,row.head,signal))
      await fetchPull(row.repo,row.pull,[headRef(row.pull.number)],signal)
    await mkdir(root,{recursive:true})
    await git(row.repo,['worktree','add','--detach','--',cwd,row.head],signal)
  }
  return realpath(cwd)
}
async function pullRemote(repo, pull, signal) {
  const link=typeof pull==='string' && pull.match(githubPR)
  const number=link?.[2] || (typeof pull==='string' && pull.match(/^#?([1-9]\d{0,11})$/)?.[1])
  if(!number) throw new Error('Use a GitHub pull request URL or a PR number for the repository’s origin.')
  const names=(await git(repo,['remote'],signal)).trim().split(/\r?\n/).filter(name=>/^[\w][\w./-]*$/.test(name))
  for(const name of link ? names : names.filter(name=>name==='origin')) {
    const url=(await git(repo,['config','--get','remote.'+name+'.url'],signal)).trim()
    const key=remoteRepository(url)
    if(key && (!link || link[1].toLowerCase()===key))
      return {url:'https://github.com/'+key+'/pull/'+number,number,remote:name,key}
  }
  throw new Error('The lead’s repository needs a matching configured GitHub remote.')
}
async function pullRefs(repo,pull,signal) {
  const url=(await git(repo,['config','--get','remote.'+pull.remote+'.url'],signal)).trim()
  if(remoteRepository(url)!==pull.key) throw new Error('The configured Git remote has changed.')
  const mergeRef='refs/pull/'+pull.number+'/merge'
  let output
  try {output=await git(repo,['ls-remote','--refs',pull.remote,headRef(pull.number),mergeRef],signal)}
  catch {signal?.throwIfAborted();throw new Error('Could not read PR refs through the repository’s Git credentials.')}
  const refs=new Map(output.trim().split(/\r?\n/).map(line=>line.split('\t').reverse()))
  const head=refs.get(headRef(pull.number)),merge=refs.get(mergeRef)
  if(!sha.test(head ?? '')) throw new Error('The Git remote did not advertise that PR head.')
  return {head,merge:sha.test(merge ?? '') ? merge : undefined}
}
async function fetchPull(repo,pull,refs,signal) {
  try {await git(repo,['-c','fetch.writeCommitGraph=false','fetch','--no-write-fetch-head','--no-tags',
    '--no-recurse-submodules','--no-auto-gc','--refmap=',pull.remote,...refs],signal)}
  catch {signal?.throwIfAborted();throw new Error('Could not fetch the PR commits. Check your Git credentials and try again.')}
}
async function pinPull(repo,pull,base,commit,signal) {
  const refs=await pullRefs(repo,pull,signal)
  if(!base && !refs.merge) throw new Error('GitHub has no test merge for this PR. Supply its target branch or base SHA.')
  await fetchPull(repo,pull,[headRef(pull.number),...(!base ? ['refs/pull/'+pull.number+'/merge'] : [])],signal)
  const head=await revision(repo,refs.head,signal)
  if(commit && await revision(repo,checkedRef(commit),signal)!==head) throw new Error('The supplied commit does not match the live PR head.')
  let target
  if(base) target=await revision(repo,checkedRef(base),signal)
  else {
    const parents=(await git(repo,['rev-list','--parents','-n','1',refs.merge],signal)).trim().split(' ')
    if(parents.length!==3 || parents[2]!==head) throw new Error('GitHub is updating the PR test merge. Retry or supply its target branch.')
    target=parents[1]
  }
  return {head,base:(await git(repo,['merge-base',head,target],signal)).trim(),pull:{...pull,target,merge:refs.merge,explicitBase:base || undefined}}
}

export async function pinSubmission({cwd, repository, branch, commit, base, pullRequest, previous, restricted}, signal) {
  const folder = await realpath(resolve(cwd,repository || '.'))
  const repo = await realpath((await git(folder,['rev-parse','--show-toplevel'],signal)).trim())
  if (restricted) {
    const root = await realpath(cwd)
    const distance = relative(root,repo)
    // A session opened in a repository subdirectory can review its owning repository.
    const ownerRepo = (await git(root,['rev-parse','--show-toplevel'],signal).catch(()=> '')).trim()
    if ((distance === '..' || distance.startsWith('..'+sep) || isAbsolute(distance)) &&
        (!ownerRepo || await realpath(ownerRepo) !== repo)) throw new Error('Choose a repository in this lead session’s workspace.')
  }
  if(pullRequest) {
    const pull=await pullRemote(repo,pullRequest,signal)
    const range=await pinPull(repo,pull,base || previous?.pull?.explicitBase,commit,signal)
    const patch=await git(repo,['diff',...diffOptions,range.base,range.head,'--'],signal,maxDiffBytes)
    if(!patch.trim()) throw new Error('This PR has no changes to review.')
    return {repo,...range,patch}
  }
  let ref
  if (branch) ref = 'refs/heads/'+checkedRef(branch)
  else {
    try { ref = (await git(repo,['symbolic-ref','-q','HEAD'],signal)).trim() }
    catch (error) { if (error.cause?.code !== 1) throw error }
  }
  const branchName = ref?.replace(/^refs\/heads\//,'')
  const tip = await revision(repo,ref || 'HEAD',signal)
  const head = commit ? await revision(repo,checkedRef(commit),signal) : tip
  if (head !== tip && ref) await git(repo,['merge-base','--is-ancestor',head,tip],signal)
  let baseSha
  if (base) {
    const target = await revision(repo,checkedRef(base),signal)
    baseSha = (await git(repo,['merge-base',head,target],signal)).trim()
  } else if (previous && previous.repo === repo && previous.branch === branchName) {
    baseSha = previous.base
  } else {
    for (const candidate of ['refs/remotes/origin/HEAD','refs/heads/main','refs/heads/master']) {
      const target = await optionalRevision(repo,candidate,signal)
      if (!target) continue
      const common = (await git(repo,['merge-base',head,target],signal)).trim()
      if (common !== head) { baseSha = common; break }
    }
    baseSha ??= await optionalRevision(repo,head+'^',signal)
  }
  const args = baseSha ? ['diff',...diffOptions,baseSha,head,'--'] :
    ['diff-tree','--root','--no-commit-id','-r','-p',...diffOptions,head,'--']
  const patch = await git(repo,args,signal,maxDiffBytes)
  if (!patch.trim()) throw new Error('These revisions have no changes to review.')
  return {repo, branch:branchName, head, base:baseSha ?? null, patch}
}

export async function branchState(row,signal) {
  try {
    if(row.pull) {
      const {head,merge}=await pullRefs(row.repo,row.pull,signal)
      if(head!==row.head) return {kind:'pull-changed',tip:head}
      if(row.pull.explicitBase) {
        const target=await revision(row.repo,row.pull.explicitBase,signal)
        return {kind:target===row.pull.target?'current':'pull-base-changed',tip:head}
      }
      if(merge!==row.pull.merge) return {kind:merge?'pull-base-changed':'unavailable',tip:head}
      return {kind:'current',tip:head}
    }
    const tip = await revision(row.repo,row.branch ? 'refs/heads/'+row.branch : 'HEAD',signal)
    if (tip === row.head) return {kind:'current',tip}
    const counts = (await git(row.repo,['rev-list','--left-right','--count',row.head+'...'+tip],signal)).trim().split(/\s+/).map(Number)
    return {kind:counts[0] ? 'diverged' : 'advanced',tip,added:counts[1],removed:counts[0]}
  } catch (error) {
    signal?.throwIfAborted()
    return {kind:'unavailable'}
  }
}

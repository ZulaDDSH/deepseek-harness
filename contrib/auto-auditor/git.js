import {execFile,spawn} from 'node:child_process'
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

async function gitCredentialToken(repoKey,signal) {
  return new Promise((resolveToken,reject)=>{
    const child=spawn('git',['credential','fill'],{
      windowsHide:true,
      env:{...process.env,GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'Never'},
    })
    let stdout='',stderr='',settled=false
    const done=fn=>{if(!settled){settled=true;signal?.removeEventListener('abort',onAbort);clearTimeout(timer);fn()}}
    const onAbort=()=>{child.kill();done(()=>reject(new Error('Git credential lookup was aborted.')))}
    const timer=setTimeout(()=>{child.kill();done(()=>reject(new Error('Git credential lookup timed out.')))},10000)
    signal?.addEventListener('abort',onAbort,{once:true})
    child.stdout.on('data',chunk=>{stdout+=chunk})
    child.stderr.on('data',chunk=>{stderr+=chunk})
    child.on('error',error=>done(()=>reject(new Error('Could not run git credential fill: '+error.message))))
    child.on('close',code=>done(()=>{
      if(code!==0) return reject(new Error('Could not read GitHub credentials from Git. '+stderr.trim().slice(0,200)))
      const fields=Object.fromEntries(stdout.split(/\r?\n/).filter(l=>l.includes('=')).map(l=>{
        const idx=l.indexOf('='); return [l.slice(0,idx),l.slice(idx+1)]
      }))
      if(!fields.password) return reject(new Error('Git has no stored GitHub token for '+repoKey+'.'))
      resolveToken(fields.password)
    }))
    child.stdin.end('protocol=https\nhost=github.com\npath='+repoKey+'.git\n\n')
  })
}

async function remotePushKey(repo,remote,signal) {
  const pushUrls=await git(repo,['config','--get-all','remote.'+remote+'.pushurl'],signal)
    .catch(error=>{if(error.cause?.code!==1) throw error;return ''})
  const configured=(pushUrls.trim() || await git(repo,['config','--get-all','remote.'+remote+'.url'],signal)).trim().split(/\r?\n/)
  const key=configured.length===1 ? remoteRepository(configured[0]) : undefined
  if(!key) throw new Error('Remote '+remote+' is not configured for a single GitHub repository.')
  return key
}

/** Read PR metadata via GitHub REST API using host Git credentials as a fallback when GitHub review status is unconfigured. */
export async function readPullViaGitCredentials(pullUrl,signal) {
  const match=typeof pullUrl==='string' && pullUrl.match(githubPR)
  if (!match) throw new Error('Enter an existing GitHub PR URL.')
  const key=match[1].toLowerCase(), number=match[2]
  const token=await gitCredentialToken(key,signal)
  const deadline=AbortSignal.timeout(12000)
  const reqSignal=signal ? AbortSignal.any([signal,deadline]) : deadline
  const res=await fetch('https://api.github.com/repos/'+key+'/pulls/'+number,{
    method:'GET',redirect:'error',signal:reqSignal,
    headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','User-Agent':'DeepSeek-Harness-Auto-Auditor'},
  })
  if (!res.ok) throw new Error('GitHub could not read PR #'+number+' using Git credentials (HTTP '+res.status+').')
  const pr=await res.json()
  if (!sha.test(pr?.head?.sha ?? '') || !sha.test(pr?.base?.sha ?? ''))
    throw new Error('GitHub did not return the current pull request revision.')
  return {
    url:'https://github.com/'+key+'/pull/'+number,
    prState:pr.merged?'MERGED':String(pr.state || '').toUpperCase(),
    draft:pr.draft===true,
    head:pr.head.sha,
    base:pr.base.sha,
    headBranch:pr.head.ref,
    headRepo:pr.head.repo?.full_name?.toLowerCase(),
  }
}

/** Push a pinned commit and find or open a GitHub PR (draft by default) in one idempotent step. */
export async function openPullForCommit(cwd,{branch,commit,base,title,body,draft=true,remote='origin',baseRemote},signal) {
  if (!sha.test(commit ?? '')) throw new Error('Specify the complete commit SHA to publish.')
  const repo=await workspaceRepo(cwd,signal)
  if (await revision(repo,commit,signal)!==commit)
    throw new Error('The proposed revision is not a commit in this workspace.')
  let headBranch=branch
  if (!headBranch) {
    try {headBranch=(await git(repo,['symbolic-ref','-q','HEAD'],signal)).trim().replace(/^refs\/heads\//,'')}
    catch {throw new Error('Specify a branch name when the workspace is on a detached HEAD.')}
  }
  headBranch=checkedRef(headBranch.replace(/^refs\/heads\//,''))
  const destination='refs/heads/'+headBranch
  await git(repo,['check-ref-format',destination],signal)
  const pushRemote=checkedRef(remote || 'origin')
  const headRepoKey=await remotePushKey(repo,pushRemote,signal)
  const targetRemote=checkedRef(baseRemote || pushRemote)
  const baseRepoKey=targetRemote===pushRemote ? headRepoKey : await remotePushKey(repo,targetRemote,signal)
  let baseBranch=base?.replace(/^refs\/heads\//,'')
  if (!baseBranch) {
    const sym=(await git(repo,['symbolic-ref','-q','refs/remotes/'+targetRemote+'/HEAD'],signal).catch(()=> '')).trim()
    baseBranch=sym ? sym.replace('refs/remotes/'+targetRemote+'/','') : 'main'
  }
  baseBranch=checkedRef(baseBranch)

  const remoteHeads=await git(repo,['ls-remote','--heads',pushRemote,destination],signal)
  const remoteTip=remoteHeads.trim().split(/\s+/)[0]
  let alreadyPushed=false
  if (sha.test(remoteTip ?? '')) {
    if (remoteTip===commit) {
      alreadyPushed=true
    } else {
      await checkFastForward(repo,remoteTip,commit,signal)
      await git(repo,['push','--no-follow-tags','--recurse-submodules=no',
        '--force-with-lease='+destination+':'+remoteTip,'--',pushRemote,commit+':'+destination],signal)
    }
  } else {
    await git(repo,['push','--no-follow-tags','--recurse-submodules=no',
      '--force-with-lease='+destination+':','--',pushRemote,commit+':'+destination],signal)
  }

  const token=await gitCredentialToken(baseRepoKey,signal)
  const headOwner=headRepoKey.split('/')[0]
  const baseOwner=baseRepoKey.split('/')[0]
  const headers={Authorization:'Bearer '+token,Accept:'application/vnd.github+json',
    'Content-Type':'application/json','User-Agent':'DeepSeek-Harness-Auto-Auditor'}
  const apiBase='https://api.github.com/repos/'+baseRepoKey+'/pulls'
  const deadline=AbortSignal.timeout(15000)
  const reqSignal=signal ? AbortSignal.any([signal,deadline]) : deadline

  const query=new URLSearchParams({state:'open',head:headOwner+':'+headBranch,base:baseBranch})
  const listRes=await fetch(apiBase+'?'+query.toString(),{method:'GET',redirect:'error',headers,signal:reqSignal})
  if (!listRes.ok) throw new Error('GitHub could not check open pull requests (HTTP '+listRes.status+').')
  const existing=await listRes.json()
  let pr=Array.isArray(existing) ? existing.find(item=>item?.state==='open' && item.head?.ref===headBranch && item.base?.ref===baseBranch) : undefined
  let alreadyOpened=Boolean(pr)
  if (!pr) {
    const headSpec=headOwner===baseOwner ? headBranch : headOwner+':'+headBranch
    const createRes=await fetch(apiBase,{
      method:'POST',redirect:'error',headers,signal:reqSignal,
      body:JSON.stringify({title,head:headSpec,base:baseBranch,body:body || '',draft:draft!==false}),
    })
    if (!createRes.ok) {
      const detail=(await createRes.text().catch(()=> '')).slice(0,220)
      throw new Error('GitHub could not open the pull request (HTTP '+createRes.status+'). '+detail)
    }
    pr=await createRes.json()
  }
  if (!pr?.number || !sha.test(pr.head?.sha ?? '') || !sha.test(pr.base?.sha ?? ''))
    throw new Error('GitHub did not return the opened pull request revision.')
  if (pr.head.sha!==commit)
    throw new Error('The open pull request head ('+pr.head.sha.slice(0,10)+') does not match the pushed commit ('+commit.slice(0,10)+').')
  return {
    url:'https://github.com/'+baseRepoKey+'/pull/'+pr.number,
    number:String(pr.number),
    head:pr.head.sha,
    base:pr.base.sha,
    baseBranch:pr.base.ref,
    headBranch:pr.head.ref,
    draft:pr.draft===true,
    alreadyPushed,
    alreadyOpened,
  }
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

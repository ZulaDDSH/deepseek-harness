import {spawn} from 'node:child_process'

const query = `
  query AuditPullRequest($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        state
        isDraft
        mergeStateStatus
        headRefOid
        baseRefOid
        headRefName
        headRepository { nameWithOwner }
        commits(last: 1) { nodes { commit { ...CheckCommit } } }
        potentialMergeCommit { ...CheckCommit }
      }
    }
  }
  fragment CheckCommit on Commit {
    oid
    statusCheckRollup {
      contexts(first: 100) {
        pageInfo { hasNextPage }
        nodes {
          __typename
          ... on CheckRun {
            name
            status
            conclusion
            detailsUrl
            isRequired(pullRequestNumber: $number)
          }
          ... on StatusContext {
            context
            state
            targetUrl
            isRequired(pullRequestNumber: $number)
          }
        }
      }
    }
  }
`
const oid = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/
const passed = new Set(['SUCCESS','SKIPPED','NEUTRAL'])
const pending = new Set(['EXPECTED','PENDING','QUEUED','IN_PROGRESS','WAITING','REQUESTED'])
const states = new Set(['OPEN','CLOSED','MERGED'])
const passingMergeStates = new Set(['CLEAN','HAS_HOOKS'])

/** Read the canonical GitHub identity of a previously submitted PR. */
export function parsePull(url) {
  const match = typeof url === 'string' &&
    /^https:\/\/github\.com\/([a-z0-9][a-z0-9-]{0,38})\/([a-z0-9_.-]{1,100})\/pull\/([1-9]\d{0,9})$/i.exec(url)
  if (!match || ['.','..'].includes(match[2]) || Number(match[3]) > 2147483647) return
  const [,owner,repo,number] = match
  const key = (owner+'/'+repo).toLowerCase()
  return {owner,repo,key,number:Number(number),url:'https://github.com/'+key+'/pull/'+number}
}

function githubCheckLink(value, fallback) {
  if (typeof value !== 'string') return fallback
  try {
    const url = new URL(value)
    if (url.origin === 'https://github.com' && !url.username && !url.password) return url.href
  } catch (error) {
    if (!(error instanceof TypeError)) throw error
  }
  return fallback
}

function requiredCheck(node, fallback) {
  if (!node?.isRequired) return
  if (node.__typename === 'CheckRun' && typeof node.name === 'string') {
    const result = node.status === 'COMPLETED'
      ? (!node.conclusion ? 'unverified' : passed.has(node.conclusion) ? 'passed' : 'failed')
      : 'pending'
    return {name:node.name,state:result,url:githubCheckLink(node.detailsUrl,fallback)}
  }
  if (node.__typename === 'StatusContext' && typeof node.context === 'string') {
    const result = passed.has(node.state) ? 'passed' : pending.has(node.state) ? 'pending' :
      node.state === 'FAILURE' || node.state === 'ERROR' ? 'failed' : 'unverified'
    return {name:node.context,state:result,url:githubCheckLink(node.targetUrl,fallback)}
  }
}

/** Interpret the recorded check set without treating an empty or partial result as a pass. */
export function parseSnapshot(pr, pull) {
  if (!states.has(pr?.state) || !oid.test(pr.headRefOid) || !oid.test(pr.baseRefOid))
    throw new Error('GitHub did not return the current pull request revision.')
  const result = {head:pr.headRefOid,base:pr.baseRefOid,prState:pr.state,draft:pr.isDraft===true,
    headBranch:pr.headRefName,headRepo:pr.headRepository?.nameWithOwner?.toLowerCase()}
  if (pr.state !== 'OPEN') return {...result,ci:'unverified'}
  const fallback = pull.url+'/checks'
  const head = pr.commits?.nodes?.[0]?.commit
  if (head?.oid !== result.head) return {...result,ci:'unverified',url:fallback}
  // GitHub evaluates the test merge commit when checks are reported on it.
  const merge = pr.potentialMergeCommit?.statusCheckRollup?.contexts
  const checks = merge?.nodes?.length ? merge : head.statusCheckRollup?.contexts
  const required = (checks?.nodes ?? []).map(node=>requiredCheck(node,fallback)).filter(Boolean)
  const failure = required.find(check=>check.state==='failed')
  if (failure) return {...result,ci:'failed',check:failure,url:failure.url}
  const waiting = required.find(check=>check.state==='pending')
  if (waiting) return {...result,ci:'pending',check:waiting,url:waiting.url}
  const proven = passingMergeStates.has(pr.mergeStateStatus) &&
    checks?.pageInfo?.hasNextPage!==true && required.every(check=>check.state==='passed')
  return {...result,ci:proven?'passed':'unverified',url:fallback}
}

/** Fetch GitHub’s read-only PR projection using the credential for this repository. */
export async function readPull(pull, token, signal) {
  const deadline = AbortSignal.timeout(8000)
  const response = await fetch('https://api.github.com/graphql',{
    method:'POST', redirect:'error', signal:signal ? AbortSignal.any([signal,deadline]) : deadline,
    headers:{Authorization:'Bearer '+token,Accept:'application/json','Content-Type':'application/json'},
    body:JSON.stringify({query,variables:{owner:pull.owner,repo:pull.repo,number:pull.number}}),
  })
  if (!response.ok) {
    await response.body?.cancel()
    if (response.status===429 || response.headers.get('x-ratelimit-remaining')==='0')
      throw new Error('GitHub rate limited this connection. The queue will retry.')
    throw new Error('GitHub could not read this PR. Check the repository access and token permissions.')
  }
  const payload = await response.json()
  if (payload.errors?.length || !payload.data?.repository?.pullRequest)
    throw new Error('GitHub could not verify this PR and its checks. Check the token permissions.')
  return parseSnapshot(payload.data.repository.pullRequest,pull)
}

/** Read the host GitHub token for a repository from Git’s credential helper without persisting it. */
export async function readGitCredentialToken(repoKey, signal) {
  return new Promise((resolveToken, reject) => {
    const child = spawn('git', ['credential', 'fill'], {
      windowsHide: true,
      env: {...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never'},
    })
    let stdout = '', stderr = '', settled = false
    const done = fn => { if (!settled) { settled = true; signal?.removeEventListener('abort', onAbort); clearTimeout(timer); fn() } }
    const onAbort = () => { child.kill(); done(() => reject(new Error('Git credential lookup was aborted.'))) }
    const timer = setTimeout(() => { child.kill(); done(() => reject(new Error('Git credential lookup timed out.'))) }, 10000)
    signal?.addEventListener('abort', onAbort, {once: true})
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.on('error', error => done(() => reject(new Error('Could not read Git credentials: ' + error.message))))
    child.on('close', code => done(() => {
      if (code !== 0) return reject(new Error('Could not read GitHub credentials from Git. ' + stderr.trim().slice(0, 200)))
      const fields = Object.fromEntries(stdout.split(/\r?\n/).filter(l => l.includes('=')).map(l => {
        const idx = l.indexOf('='); return [l.slice(0, idx), l.slice(idx + 1)]
      }))
      if (!fields.password) return reject(new Error('Git has no stored GitHub credentials for ' + repoKey + '.'))
      resolveToken(fields.password)
    }))
    child.stdin.end('protocol=https\nhost=github.com\npath=' + repoKey + '.git\n\n')
  })
}

/** Relate the GitHub revision to the exact head and target recorded by Auto Auditor. */
export function auditRevision(row, snapshot) {
  if (!snapshot.head || !snapshot.base) return 'unverified'
  if (row.head !== snapshot.head || (row.pull?.target && row.pull.target !== snapshot.base)) return 'changed'
  return row.pull?.target ? 'current' : 'unverified'
}

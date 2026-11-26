import {createHash} from 'node:crypto'
import {mkdir,readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {withFileLock,writeFileAtomic} from '@deepseek-ai/dsh-atomic-write'
import {auditRevision,listAccessibleRepositories,parsePull,parseRepoKey,readGitCredentialToken,readPull,readRepository} from './github.js'

export const name = 'desktop-github-review-status'
export const inject = ['profileContext','connection','webServer','credentials']
const channel = '/desktop-github-review-status'
const credential = key => 'DSH_GITHUB_REVIEW_'+createHash('sha256').update(key).digest('hex').toUpperCase()
const limits = {rows:12,requests:4,cache:128,refreshMs:45000,failureMs:90000,discoverMs:60000}
const patPattern = /^(?:github_pat_[A-Za-z0-9_]{20,256}|ghp_[A-Za-z0-9]{20,256})$/

/** Serve GitHub status for persisted audit submissions and manage their read credentials. */
export function apply(ctx) {
  const dir = join(ctx.profileContext.dir,'auto-auditor')
  const filename = join(dir,'queue.json')
  const gitAuthFile = join(dir,'github-git-auth.json')
  const cache = new Map()
  const discoveredCache = {expires:0,repos:[],error:''}
  const lifetime = new AbortController()
  ctx.effect(()=>()=>lifetime.abort(),'GitHub status request lifetime')

  async function readGitAuth() {
    try {
      const raw = JSON.parse(await readFile(gitAuthFile,'utf8'))
      if (Array.isArray(raw)) {
        return {allRepos:false,repos:new Set(raw.filter(item=>typeof item==='string')),excluded:new Set()}
      }
      return {
        allRepos:raw?.allRepos === true,
        repos:new Set(Array.isArray(raw?.repos) ? raw.repos.filter(item=>typeof item==='string') : []),
        excluded:new Set(Array.isArray(raw?.excluded) ? raw.excluded.filter(item=>typeof item==='string') : []),
      }
    } catch (error) {
      if (error.code === 'ENOENT') return {allRepos:false,repos:new Set(),excluded:new Set()}
      throw error
    }
  }
  async function updateGitAuth(edit) {
    await mkdir(dir,{recursive:true})
    return withFileLock(gitAuthFile,async()=>{
      const state = await readGitAuth()
      await edit(state)
      const payload = {
        allRepos:state.allRepos === true,
        repos:[...state.repos].sort(),
        excluded:[...state.excluded].sort(),
      }
      await writeFileAtomic(gitAuthFile,JSON.stringify(payload),{mode:0o600})
      return state
    })
  }
  async function resolveToken(key, signal) {
    const stored = (await ctx.credentials.resolve(credential(key)))?.value
    if (stored) return stored
    const auth = await readGitAuth()
    if (auth.repos.has(key) || (auth.allRepos && !auth.excluded.has(key)))
      return readGitCredentialToken(key,signal)
    return undefined
  }

  ctx.provide('githubReviewStatus',{
    async target(url,signal) {
      const pull=parsePull(url)
      if (!pull) throw new Error('Enter an existing GitHub PR URL.')
      const token=await resolveToken(pull.key,signal)
      if (!token) throw new Error('Connect the PR’s repository in Settings → GitHub review status.')
      return {...await readPull(pull,token,signal),url:pull.url}
    },
  })

  async function reviews() {
    try {
      const state = JSON.parse(await readFile(filename,'utf8'))
      return state.rows.flatMap(row=>{
        const pull = parsePull(row.pull?.url)
        return pull ? [{row,pull}] : []
      })
    } catch (error) {
      if (error.code === 'ENOENT') return []
      throw error
    }
  }

  function snapshot(pull) {
    const cached = cache.get(pull.url)
    if (cached && (cached.pending || cached.expires > Date.now())) return cached.promise
    const entry = {pending:true}
    entry.promise = (async()=>{
      let wait = limits.refreshMs
      try {
        const token = await resolveToken(pull.key,lifetime.signal)
        if (!token) return {connection:'unconfigured',ci:'unverified'}
        return {connection:'connected',...await readPull(pull,token,lifetime.signal)}
      } catch (error) {
        wait = limits.failureMs
        return {connection:'unavailable',ci:'unverified',
          error:error.name==='AbortError' || error.name==='TimeoutError' || error instanceof TypeError
            ? 'GitHub did not respond. The queue will retry.' : error.message}
      } finally {
        entry.pending = false
        entry.expires = Date.now()+wait
      }
    })()
    cache.delete(pull.url)
    cache.set(pull.url,entry)
    if (cache.size > limits.cache) {
      for (const [url,record] of cache) {
        if (!record.pending) cache.delete(url)
        if (cache.size <= limits.cache) break
      }
    }
    return entry.promise
  }

  async function statuses(rows, ids, signal) {
    if (!Array.isArray(ids) || ids.length>limits.rows || ids.some(id=>typeof id!=='string' || id.length>64))
      throw new Error('Choose up to '+limits.rows+' submitted reviews.')
    const selected = new Set(ids)
    const matches = rows.filter(({row})=>selected.has(row.id))
    const result = []
    for (let offset=0; offset<matches.length; offset+=limits.requests) {
      signal?.throwIfAborted()
      const batch = await Promise.all(matches.slice(offset,offset+limits.requests).map(async({row,pull})=>{
        const status = await snapshot(pull)
        return {id:row.id,...status,audit:auditRevision(row,status)}
      }))
      result.push(...batch)
    }
    return result
  }

  async function discoverRepositories(signal, force = false) {
    if (!force && discoveredCache.expires > Date.now()) return discoveredCache
    try {
      const token = await readGitCredentialToken('',signal)
      const repos = await listAccessibleRepositories(token,signal)
      discoveredCache.repos = repos
      discoveredCache.error = ''
      discoveredCache.expires = Date.now() + limits.discoverMs
    } catch (error) {
      discoveredCache.error = error.message
      discoveredCache.expires = Date.now() + 15000
    }
    return discoveredCache
  }

  async function repositories(rows, {discover = false, refresh = false, signal} = {}) {
    const tracked = new Set(rows.map(({pull})=>pull.key))
    const auth = await readGitAuth()
    const meta = new Map()
    if (discover) {
      const discovered = await discoverRepositories(signal,refresh)
      for (const repo of discovered.repos) meta.set(repo.key,repo)
    }
    const keys = new Set([...tracked,...auth.repos,...meta.keys()])
    return Promise.all([...keys].sort().map(async key=>{
      const hasToken = (await ctx.credentials.describe(credential(key))).configured
      const explicitGit = auth.repos.has(key)
      const viaAllRepos = !hasToken && !explicitGit && auth.allRepos && !auth.excluded.has(key)
      const hasGit = explicitGit || viaAllRepos
      const info = meta.get(key)
      return {
        key,
        fullName:info?.fullName || key,
        owner:info?.owner || key.split('/')[0],
        private:info?.private === true,
        archived:info?.archived === true,
        tracked:tracked.has(key),
        configured:Boolean(hasToken || hasGit),
        authMode:hasToken?'token':hasGit?'git':'none',
        viaAllRepos,
      }
    }))
  }

  async function configure(method, rows, args, signal) {
    const parsed = parseRepoKey(args.key)
    if (!parsed) throw new Error('Choose a valid GitHub repository (owner/name).')
    const pull = rows.find(item=>item.pull.key===parsed.key)?.pull
    const reference = credential(parsed.key)
    if (method==='disconnect') {
      await ctx.credentials.unset(reference)
      await updateGitAuth(state=>{
        state.repos.delete(parsed.key)
        if (state.allRepos) state.excluded.add(parsed.key)
      })
    } else if (method==='connect-git') {
      const token = await readGitCredentialToken(parsed.key,signal)
      if (pull) await readPull(pull,token,signal)
      else await readRepository(parsed.key,token,signal)
      signal?.throwIfAborted()
      await ctx.credentials.unset(reference)
      await updateGitAuth(state=>{
        state.repos.add(parsed.key)
        state.excluded.delete(parsed.key)
      })
    } else {
      const token = typeof args.token==='string' ? args.token.trim() : ''
      if (!patPattern.test(token))
        throw new Error('Enter a GitHub personal access token (github_pat_… or ghp_…).')
      if (pull) await readPull(pull,token,signal)
      else await readRepository(parsed.key,token,signal)
      signal?.throwIfAborted()
      await ctx.credentials.set(reference,token)
      await updateGitAuth(state=>{
        state.repos.delete(parsed.key)
        state.excluded.delete(parsed.key)
      })
    }
    const prefix = 'https://github.com/'+parsed.key+'/pull/'
    for (const url of cache.keys()) if (url.startsWith(prefix)) cache.delete(url)
    return repositories(rows,{discover:Boolean(args.discover),signal})
  }

  ctx.connection.register(ctx,channel,async(method,args={},signal,peer)=>{
    if (peer?.principal?.kind!=='owner')
      return {ok:false,error:{code:'forbidden',message:'Owner access required.',details:{}}}
    try {
      const rows = await reviews()
      let value
      if (method==='snapshot') value=await statuses(rows,args.ids,signal)
      else if (method==='repositories') value=await repositories(rows,{discover:Boolean(args.discover),refresh:Boolean(args.refresh),signal})
      else if (method==='account') {
        const auth = await readGitAuth()
        if (args.discover) await discoverRepositories(signal,Boolean(args.refresh))
        value = {
          allReposGit:auth.allRepos,
          discoveredCount:discoveredCache.repos.length,
          discoveryError:discoveredCache.error || '',
        }
      } else if (method==='connect-all-git') {
        const token = await readGitCredentialToken('',signal)
        const repos = await listAccessibleRepositories(token,signal)
        signal?.throwIfAborted()
        discoveredCache.repos = repos
        discoveredCache.error = ''
        discoveredCache.expires = Date.now() + limits.discoverMs
        await updateGitAuth(state=>{
          state.allRepos = true
          state.excluded.clear()
        })
        cache.clear()
        value = {allReposGit:true,discoveredCount:repos.length,repositories:await repositories(rows,{discover:true,signal})}
      } else if (method==='disconnect-all-git') {
        await updateGitAuth(state=>{
          state.allRepos = false
          state.excluded.clear()
        })
        cache.clear()
        value = {allReposGit:false,discoveredCount:discoveredCache.repos.length,repositories:await repositories(rows,{discover:Boolean(args.discover),signal})}
      } else if (method==='connect' || method==='connect-git' || method==='disconnect') value=await configure(method,rows,args,signal)
      else throw new Error('Unknown GitHub review action.')
      return {ok:true,value}
    } catch (error) {
      return {ok:false,error:{code:'github-review-status/error',
        message:error instanceof TypeError ? 'Unable to read the submitted pull request.' : error.message,details:{}}}
    }
  })
}

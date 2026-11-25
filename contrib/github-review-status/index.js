import {createHash} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {auditRevision,parsePull,readPull} from './github.js'

export const name = 'desktop-github-review-status'
export const inject = ['profileContext','connection','webServer','credentials']
const channel = '/desktop-github-review-status'
const credential = key => 'DSH_GITHUB_REVIEW_'+createHash('sha256').update(key).digest('hex').toUpperCase()
const limits = {rows:12,requests:4,cache:128,refreshMs:45000,failureMs:90000}

/** Serve GitHub status for persisted audit submissions and manage their read credentials. */
export function apply(ctx) {
  const filename = join(ctx.profileContext.dir,'auto-auditor','queue.json')
  const cache = new Map()
  const lifetime = new AbortController()
  ctx.effect(()=>()=>lifetime.abort(),'GitHub status request lifetime')
  ctx.provide('githubReviewStatus',{
    async target(url,signal) {
      const pull=parsePull(url)
      if (!pull) throw new Error('Enter an existing GitHub PR URL.')
      const token=(await ctx.credentials.resolve(credential(pull.key)))?.value
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
        const token = (await ctx.credentials.resolve(credential(pull.key)))?.value
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

  async function repositories(rows) {
    const unique = new Set(rows.map(({pull})=>pull.key))
    return Promise.all([...unique].sort().map(async key=>({
      key,configured:(await ctx.credentials.describe(credential(key))).configured,
    })))
  }

  async function configure(method, rows, args, signal) {
    const pull = rows.find(item=>item.pull.key===args.key)?.pull
    if (!pull) throw new Error('Submit a PR from this repository to Auto Auditor first.')
    const reference = credential(pull.key)
    if (method==='disconnect') {
      await ctx.credentials.unset(reference)
    } else {
      const token = typeof args.token==='string' ? args.token.trim() : ''
      if (!/^github_pat_[A-Za-z0-9_]{20,256}$/.test(token))
        throw new Error('Enter a fine-grained GitHub personal access token.')
      await readPull(pull,token,signal)
      signal?.throwIfAborted()
      await ctx.credentials.set(reference,token)
    }
    const prefix = 'https://github.com/'+pull.key+'/pull/'
    for (const url of cache.keys()) if (url.startsWith(prefix)) cache.delete(url)
    return repositories(rows)
  }

  ctx.connection.register(ctx,channel,async(method,args={},signal,peer)=>{
    if (peer?.principal?.kind!=='owner')
      return {ok:false,error:{code:'forbidden',message:'Owner access required.',details:{}}}
    try {
      const rows = await reviews()
      let value
      if (method==='snapshot') value=await statuses(rows,args.ids,signal)
      else if (method==='repositories') value=await repositories(rows)
      else if (method==='connect' || method==='disconnect') value=await configure(method,rows,args,signal)
      else throw new Error('Unknown GitHub review action.')
      return {ok:true,value}
    } catch (error) {
      return {ok:false,error:{code:'github-review-status/error',
        message:error instanceof TypeError ? 'Unable to read the submitted pull request.' : error.message,details:{}}}
    }
  })
}

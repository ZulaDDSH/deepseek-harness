import {randomUUID} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {withFileLock,writeFileAtomic} from '@deepseek-ai/dsh-atomic-write'

/** Resolve the profile’s PR Fixer chat and retain its identity when renamed. */
export function fixerSession(ctx) {
  const filename=join(ctx.profileContext.dir,'pr-fixer-session.json')
  async function linked() {
    try {return JSON.parse(await readFile(filename,'utf8')).sessionId}
    catch (error) {if(error.code==='ENOENT') return null;throw error}
  }
  const save=sessionId=>writeFileAtomic(filename,JSON.stringify({sessionId})+'\n',{mode:0o600})
  async function state(signal) {
    const archived=new Set(ctx.workspaceRegistry.archivedSessionIds)
    const {items}=await ctx.sessionController.list({},signal)
    const records=items.filter(item=>item.cwd && item.origin!=='subagent' && !archived.has(item.sessionId) &&
      !item.sessionId.startsWith('desktop-master-control-') && item.formatStatus!=='migration-required')
      .map(item=>({id:item.sessionId,title:item.projections?.values?.title || item.sessionId}))
    const workspaces=ctx.workspaceRegistry.list().filter(item=>item.path).map(item=>({id:item.id,title:item.title || item.path}))
    return {records,workspaces}
  }
  return (method,args,signal)=>withFileLock(filename,async()=>{
    const {records,workspaces}=await state(signal)
    const saved=await linked()
    const named=records.filter(item=>item.title.trim().toLowerCase()==='pr fixer')
    let sessionId=records.find(item=>item.id===saved)?.id ?? null
    if (!saved && named.length===1) {
      sessionId=named[0].id
      await save(sessionId)
    }
    if (method==='fixer-link') {
      const match=records.find(item=>item.id===args.sessionId)
      if (!match) throw new Error('Choose an active workspace session.')
      sessionId=match.id
      await save(sessionId)
    } else if (method==='fixer-create') {
      if (sessionId) throw new Error('A PR Fixer chat is already linked.')
      const workspace=ctx.workspaceRegistry.get(args.workspaceId)
      if (!workspace?.path) throw new Error('Choose a workspace for PR Fixer.')
      const created=await ctx.sessionController.create({sessionId:'desktop-pr-fixer-'+randomUUID(),cwd:workspace.path})
      sessionId=created.sessionId
      await ctx.sessionController.rename({sessionId,title:'PR Fixer'})
      await workspace.attachSession(sessionId)
      const session=ctx.sessions.get(sessionId)
      if (session && !await ctx.sessions.flush(session)) throw new Error('The Harness could not save the PR Fixer chat.')
      await save(sessionId)
    }
    return {sessionId,workspaces,sessions:records.slice(0,80)}
  },{signal})
}

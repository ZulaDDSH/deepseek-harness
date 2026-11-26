import {randomUUID} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {withFileLock,writeFileAtomic} from '@deepseek-ai/dsh-atomic-write'

export function label(value) {
  const name=typeof value==='string' ? value.trim() : ''
  if(!name || name.length>48 || /[\p{Cc}\p{Cf}]/u.test(name)) throw new Error('Enter a name of 1–48 characters.')
  return name
}

export function partitions(ctx) {
  const filename=join(ctx.profileContext.dir,'workspace-partitions.json')
  async function read() {
    try {return JSON.parse(await readFile(filename,'utf8'))}
    catch(error) {if(error.code==='ENOENT') return {revision:0,workspaces:[]};throw error}
  }
  async function edit(action,args,signal) {
    return withFileLock(filename,async()=>{
      const state=await read()
      const workspace=ctx.workspaceRegistry.get(args.workspaceId)
      if(!workspace) throw new Error('This workspace is no longer available.')
      if(args.sessionId!==undefined && (typeof args.sessionId!=='string' ||
        !workspace.sessionIds.includes(args.sessionId) || ctx.workspaceRegistry.archivedSessionIds.includes(args.sessionId)))
        throw new Error('This chat is no longer active in this workspace.')
      let group=state.workspaces.find(item=>item.id===workspace.id)
      if(!group) {
        group={id:workspace.id,partitions:[]}
        state.workspaces.push(group)
      }
      const partition=group.partitions.find(item=>item.id===args.partitionId)
      if(action==='create' || action==='rename') {
        const name=label(args.name)
        if(group.partitions.some(item=>item!==partition && item.name.toLowerCase()===name.toLowerCase()))
          throw new Error('This workspace already has a partition with that name.')
        if(action==='create') {
          if(group.partitions.length>=60) throw new Error('A workspace can have up to 60 partitions.')
          const created={id:randomUUID(),name,collapsed:false,sessions:[]}
          if(args.sessionId!==undefined) {
            for(const item of group.partitions) item.sessions=item.sessions.filter(id=>id!==args.sessionId)
            created.sessions.push(args.sessionId)
          }
          group.partitions.push(created)
        } else {
          if(!partition) throw new Error('This partition is no longer available.')
          partition.name=name
        }
      } else if(action==='move'){
        if(!args.sessionId) throw new Error('Choose a chat to move.')
        if(args.partitionId!==null && !partition) throw new Error('This partition is no longer available.')
        for(const item of group.partitions) item.sessions=item.sessions.filter(id=>id!==args.sessionId)
        partition?.sessions.push(args.sessionId)
      } else {
        if(!partition) throw new Error('This partition is no longer available.')
        if(action==='collapse' && typeof args.collapsed==='boolean') partition.collapsed=args.collapsed
        else if(action==='delete') group.partitions=group.partitions.filter(item=>item!==partition)
        else throw new Error('Unknown partition action.')
      }
      if(!group.partitions.length) state.workspaces=state.workspaces.filter(item=>item!==group)
      state.revision++
      signal?.throwIfAborted()
      await writeFileAtomic(filename,JSON.stringify(state)+'\n',{mode:0o600})
      return state
    },{signal})
  }
  return {read,edit}
}

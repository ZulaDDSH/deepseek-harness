import {partitions} from './partitions.js'
import {attachGoSessionHeader,openCodeAccounts} from './opencode.js'

export const name='desktop-workspace-organizer'
export const inject=['profileContext','workspaceRegistry','connection','webServer','llm','settings','credentials']
const partitionActions=new Set(['create','rename','move','collapse','delete'])

export function apply(ctx) {
  const folders=partitions(ctx)
  const accounts=openCodeAccounts(ctx)
  attachGoSessionHeader(ctx)
  ctx.connection.register(ctx,'/desktop-workspace-organizer',async(method,args={},signal,peer)=>{
    if(peer?.principal?.kind!=='owner')
      return {ok:false,error:{code:'forbidden',message:'Owner access required.',details:{}}}
    try {
      let value
      if(method==='partitions') value=await folders.read()
      else if(partitionActions.has(method)) value=await folders.edit(method,args,signal)
      else if(method==='go-list') value=await accounts.list()
      else if(method==='go-add' || method==='go-rename') value=await accounts.write(method.slice(3),args,signal)
      else throw new Error('Unknown workspace organization action.')
      return {ok:true,value}
    } catch(error) {
      return {ok:false,error:{code:'workspace-organizer/error',message:error.message,details:{}}}
    }
  })
}

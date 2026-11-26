export const name='antigravity-accounts'
export const inject=['llm','connection','webServer']
export const channel='/antigravity-accounts'

export function apply(ctx) {
  ctx.connection.register(ctx,channel,async(method,_args,_signal,peer)=>{
    if(peer?.principal?.kind!=='owner')
      return {ok:false,error:{code:'forbidden',message:'Only the local Harness owner can view accounts.',details:{}}}
    if(method!=='list')
      return {ok:false,error:{code:'unknown_method',message:'Unknown Antigravity account action.',details:{}}}
    try {
      const models=await ctx.llm.listModels('antigravity-cli')
      return {ok:true,value:models.map(({id,name})=>({id,name}))}
    } catch {
      return {ok:false,error:{code:'catalog_unavailable',message:'Could not list Antigravity models. Run agy in a terminal and check your sign-in, then refresh.',details:{}}}
    }
  })
}

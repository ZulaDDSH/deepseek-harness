import {spawn} from 'node:child_process'
import {agyCommand} from './command.js'

export const name='antigravity-accounts'
export const inject=['llm','connection','webServer']
export const channel='/antigravity-accounts'

function googleAuthorizationLink(output) {
  for(const [value] of output.matchAll(/https:\/\/[^\s<>"']+(?=\s)/g)) {
    let url
    try {url=new URL(value)} catch {continue}
    if(url.origin==='https://accounts.google.com' && !url.username && !url.password &&
        ['/o/oauth2/auth','/o/oauth2/v2/auth'].includes(url.pathname) && url.searchParams.get('state'))
      return url.href
  }
}

export function apply(ctx,config={}) {
  let login, state={status:'idle'}
  const fail=(code,message)=>({ok:false,error:{code,message,details:{}}})
  const clear=reason=>{
    if(!login) return
    clearTimeout(login.timer)
    login.cancelled=true
    login.child.kill()
    state={status:'error',message:reason}
  }

  function start() {
    if(login) return
    const child=spawn(agyCommand(config),['acp','--login'],{windowsHide:true,stdio:['pipe','pipe','pipe']})
    const attempt={child,timer:setTimeout(()=>clear('Google sign-in timed out. Start a new sign-in to try again.'),10*60_000)}
    login=attempt
    state={status:'starting'}
    let output=''
    for(const stream of [child.stdout,child.stderr]) stream.on('data',chunk=>{
      if(login!==attempt || state.status!=='starting') return
      output=(output+chunk).slice(-32_768)
      const url=googleAuthorizationLink(output)
      if(url) state={status:'authorization',url}
    })
    child.stdin.on('error',()=>{
      if(login===attempt && !attempt.cancelled)
        clear('Antigravity CLI stopped accepting input. Start a new sign-in to try again.')
    })
    child.on('error',()=>{
      if(login===attempt && !attempt.cancelled)
        state={status:'error',message:'Could not start Antigravity CLI. Check that agy is installed.'}
    })
    child.once('close',code=>{
      clearTimeout(attempt.timer)
      if(login!==attempt) return
      login=undefined
      if(attempt.cancelled) return
      if(code===0) {
        state={status:'complete'}
        ctx.emit('llm/adapters-updated')
      } else if(state.status!=='error') {
        state={status:'error',message:'Google sign-in did not complete. Start a new sign-in to try again.'}
      }
    })
  }

  ctx.effect(()=>()=>clear('Google sign-in was interrupted.'),'Antigravity sign-in process')
  ctx.connection.register(ctx,channel,async(method,args,_signal,peer)=>{
    if(peer?.principal?.kind!=='owner')
      return fail('forbidden','Only the local Harness owner can manage Antigravity sign-in.')
    if(method==='start') start()
    else if(method==='cancel') clear('Google sign-in was cancelled.')
    else if(method==='authorize') {
      const code=typeof args?.code==='string' ? args.code.trim() : ''
      if(!login || state.status!=='authorization')
        return fail('no_login','Start Google sign-in before submitting an authorization code.')
      if(!code || code.length>4096 || /[\r\n\u0000]/.test(code))
        return fail('invalid_code','Enter the authorization code Google gave you.')
      state={status:'verifying'}
      login.child.stdin.end(code+'\n')
    } else if(method==='list') {
      try {
        const models=await ctx.llm.listModels('antigravity-cli')
        ctx.emit('llm/adapters-updated')
        return {ok:true,value:models.map(({id,name})=>({id,name}))}
      } catch {
        return fail('catalog_unavailable','Could not list Antigravity models. Sign in with Google, then refresh.')
      }
    } else if(method!=='status') return fail('unknown_method','Unknown Antigravity account action.')
    return {ok:true,value:state}
  })
}

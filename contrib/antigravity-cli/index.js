import {execFile, spawn} from 'node:child_process'
import {once} from 'node:events'
import {promisify} from 'node:util'
import {LlmAdapter,LlmError} from '@deepseek-ai/dsh-llm'

const exec=promisify(execFile)
export const name='antigravity-cli'
export const inject=['llm','sessions','permissionPresets']
const settings=JSON.stringify({toolPermission:'strict'})

export function apply(ctx,config={}) {
  const command=config.command || 'agy'
  class Adapter extends LlmAdapter {
    providerInfo(provider) {
      return {id:provider,name:'Antigravity CLI'}
    }

    async listModels(provider) {
      const {stdout}=await exec(command,['models'],{windowsHide:true,timeout:15000})
      return stdout.split(/\r?\n/).flatMap(line=>{
        const [id,label]=line.trim().split('\t')
        return /^[\w.-]+$/.test(id) && label ? [{provider,id,name:label,inputModalities:['text'],contextWindow:128000}] : []
      })
    }

    async *stream(options) {
      const session=options.sessionId && ctx.sessions.get(options.sessionId)
      if(!session || ctx.permissionPresets.current(session)!=='danger-full-access')
        throw new LlmError('Antigravity CLI requires a Full access chat because it runs its own agent.','UNSUPPORTED_OPTION')
      const cwd=session.header.cwd
      const model=options.model
      if(!/^[\w.-]+$/.test(model) || model.startsWith('-'))
        throw new LlmError('Choose a model listed by agy models.','INVALID_REQUEST')
      const prompt=JSON.stringify({system:options.system,messages:options.messages})
      const child=spawn(command,['--model',model,'--disable-slash-commands','--settings',settings,
        '--input-format','stream-json','--output-format','stream-json','--print-timeout','10m'],
      {cwd,signal:options.signal,windowsHide:true,stdio:['pipe','pipe','ignore']})
      const closed=once(child,'close').then(([code])=>({code}),error=>({error}))
      child.stdin.on('error',()=>{}) // The process status owns early stdin failures.
      child.stdin.end(JSON.stringify({event:'user',message:{content:prompt}})+'\n')
      let output=''
      try {
        for await(const chunk of child.stdout) {
          output+=chunk
          if(output.length>8_000_000) throw new LlmError('Antigravity CLI output exceeded the limit.','MALFORMED_RESPONSE')
        }
        const {code,error}=await closed
        if(error) throw error
        const result=output.trim().split(/\r?\n/).map(line=>JSON.parse(line)).findLast(event=>event.event==='result')?.result
        if(code!==0 || result?.status!=='SUCCESS' || !result.response?.trim())
          throw new LlmError('Antigravity CLI could not complete the turn. Check its sign-in, model availability, and quota.','INVALID_REQUEST')
        yield {type:'text-delta',index:0,text:result.response}
        yield {type:'finish',reason:{kind:'stop'}}
      } finally {
        child.kill()
        await closed
      }
    }
  }
  ctx.effect(()=>ctx.llm.registerAdapter([name],new Adapter()),'Antigravity CLI provider')
}

import {execFile, spawn} from 'node:child_process'
import {once} from 'node:events'
import {randomUUID} from 'node:crypto'
import {tmpdir} from 'node:os'
import {promisify} from 'node:util'
import {LlmAdapter,LlmError} from '@deepseek-ai/dsh-llm'
import {agyCommand} from './command.js'
import {parseTurn} from './turn-result.js'
import {bridgePrompt,bridgeResult,bridgeSchema} from './tool-bridge.js'

const exec=promisify(execFile)
export const name='antigravity-cli'
export const inject=['llm','sessions','permissionPresets']
const settings=JSON.stringify({toolPermission:'strict'})

export function apply(ctx,config={}) {
  const command=agyCommand(config)
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
      const tools=(options.tools ?? []).filter(tool=>!tool.deferLoading)
      const model=options.model
      if(!/^[\w.-]+$/.test(model) || model.startsWith('-'))
        throw new LlmError('Choose a model listed by agy models.','INVALID_REQUEST')
      async function request(prompt) {
        const child=spawn(command,['--model',model,'--disable-slash-commands','--settings',settings,
          '--input-format','stream-json','--output-format','stream-json','--print-timeout','10m',
          ...(tools.length ? ['--json-schema',JSON.stringify(bridgeSchema)] : [])],
        {cwd:tmpdir(),signal:options.signal,windowsHide:true,stdio:['pipe','pipe','pipe']})
        const closed=once(child,'close').then(([code])=>({code}),error=>({error}))
        child.stdin.on('error',()=>{}) // The process status owns early stdin failures.
        child.stdin.end(JSON.stringify({event:'user',message:{content:prompt}})+'\n')
        child.stdout.setEncoding('utf8')
        child.stderr.setEncoding('utf8')
        let diagnostic=''
        child.stderr.on('data',text=>{diagnostic=(diagnostic+text).slice(-32_768)})
        let output=''
        try {
          for await(const chunk of child.stdout) {
            output+=chunk
            if(output.length>8_000_000) throw new LlmError('Antigravity CLI output exceeded the limit.','MALFORMED_RESPONSE')
          }
          const {code,error}=await closed
          if(error) throw error
          const result=parseTurn(output,diagnostic,code)
          if(result.code) throw new LlmError(result.message,result.code)
          return result.text
        } finally {
          child.kill()
          await closed
        }
      }

      let response
      if(tools.length) {
        const requestOptions={...options,tools}
        response=bridgeResult(await request(bridgePrompt(requestOptions)),tools)
        if(response.error)
          response=bridgeResult(await request(bridgePrompt(requestOptions,
            'The last response was rejected and no tool ran. Choose an exact tool name from harnessTools or return an answer. '+response.error)),tools)
        if(response.error) throw new LlmError(response.error,'MALFORMED_RESPONSE')
      } else {
        response={text:await request(JSON.stringify({system:options.system,messages:options.messages}))}
      }
      if(response.name) {
        yield {type:'block-end',index:0,block:{type:'tool-call',id:randomUUID(),name:response.name,arguments:response.arguments}}
        yield {type:'finish',reason:{kind:'tool-calls'}}
        return
      }
      yield {type:'text-delta',index:0,text:response.text}
      yield {type:'finish',reason:{kind:'stop'}}
    }
  }
  ctx.effect(()=>ctx.llm.registerAdapter([name],new Adapter()),'Antigravity CLI provider')
}

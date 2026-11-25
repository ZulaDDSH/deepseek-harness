import assert from 'node:assert/strict'
import test from 'node:test'
import {registerOwnerTools,shellVerdict} from './pr-owner.js'

test('only the assigned session can defer a live PR, including before the handoff completes',async()=>{
  const entries=new Map()
  const row={id:'review',owner:{},status:'owned',pull:{url:'example'},fixerJob:{}}
  const queue={read:async()=>({rows:[row]}),deferOwner:async(id,reason)=>({id,status:'deferred',reason})}
  registerOwnerTools({tools:{register:tool=>entries.set(tool.name,tool)}},
    {queue,defineTool:tool=>tool,parameter:description=>({description})})
  const finish=entries.get('auditor_finish').execute
  const args={review_id:row.id,commit:'1'.repeat(40),outcome:'deferred',evidence:'The evidence does not settle the defect.'}
  await assert.rejects(finish(args,{}),/assigned PR owner/)
  row.fixerJob.sessionId='owner'
  await assert.rejects(finish(args,{agent:{id:'lead'}}),/assigned PR owner/)
  assert.equal(JSON.parse(await finish(args,{agent:{id:'owner'}})).status,'deferred')
  row.automationPaused=true
  await assert.rejects(finish(args,{agent:{id:'owner'}}),/assigned PR owner/)
})

const commit='1'.repeat(40)
const plan={at:100,command:'git rev-parse HEAD && npm test && echo AUDIT_PASS'}
function run(id,output,options={}) {
  return [
    {time:options.time ?? 101,type:'tool/call',data:{name:'bash',callId:id,
      arguments:JSON.stringify({command:options.command ?? plan.command,run_in_background:options.background})}},
    {type:'tool/result',data:{message:{toolCallId:id,isError:options.error,content:[{type:'text',text:output}]}}},
  ]
}

test('matches a completed foreground check to the frozen command and candidate',()=>{
  for(const suffix of ['','\r\n[Command finished with exit code 0]']) {
    const events=run('a',commit+'\r\n12 tests passed\r\nAUDIT_PASS'+suffix)
    assert.equal(shellVerdict(events,plan,commit),'passed')
  }
})

test('rejects missing, stale, changed and background checks',()=>{
  const output=commit+'\nAUDIT_PASS'
  for(const events of [[],run('a',output,{time:99}),run('a',output,{background:true}),
    run('a',output,{command:'echo AUDIT_PASS'}),run('a','another SHA\nAUDIT_PASS'),run('a',commit+'\nstarted background job test')]) {
    assert.equal(shellVerdict(events,plan,commit),undefined)
  }
})

test('a newer failed or interrupted run supersedes the previous pass',()=>{
  const output=commit+'\nAUDIT_PASS'
  for(const error of ['[exit code: 1]','[Command finished with exit code 1]','[timed out after 1ms]','[stopped: user]']) {
    assert.equal(shellVerdict([...run('a',output),...run('b',output+'\n'+error)],plan,commit),'failed')
  }
  assert.equal(shellVerdict(run('a',output,{error:true}),plan,commit),'failed')
})

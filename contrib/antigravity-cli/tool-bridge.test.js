import assert from 'node:assert/strict'
import test from 'node:test'
import {bridgePrompt,bridgeResult} from './tool-bridge.js'

const tools=[{name:'read',description:'Read a workspace file.',parameters:{type:'object'}}]
const call=(name,args)=>JSON.stringify({kind:'tool',text:'',name,arguments:args})

test('serializes the offered tools and existing tool result messages',()=>{
  const messages=[{role:'tool',toolCallId:'call',content:[{type:'text',text:'fixture output'}]}]
  const prompt=JSON.parse(bridgePrompt({system:'system',messages,tools}))
  assert.deepEqual(prompt.harnessTools,tools)
  assert.deepEqual(prompt.messages,messages)
  assert.equal(prompt.system,'system')
})

test('only converts an offered tool with object arguments',()=>{
  assert.deepEqual(bridgeResult(call('read','{"path":"fixture"}'),tools),{name:'read',arguments:'{"path":"fixture"}'})
  for(const value of [call('hidden','{}'),call('read','[]'),call('read','null'),call('read','{'),call('read','x'.repeat(128001))])
    assert.equal(typeof bridgeResult(value,tools).error,'string')
})

test('only accepts an explicit nonempty final answer without a tool request',()=>{
  const answer={kind:'answer',text:'done',name:'',arguments:''}
  assert.deepEqual(bridgeResult(JSON.stringify(answer),tools),{text:'done'})
  assert.equal(typeof bridgeResult(JSON.stringify({...answer,name:'read'}),tools).error,'string')
  assert.equal(typeof bridgeResult('plain text',tools).error,'string')
})

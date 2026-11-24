import assert from 'node:assert/strict'
import {test} from 'node:test'
import {apiAccounts} from '../api-accounts.js'

test('API accounts have separate routes and credentials and only expose names and status', async()=>{
  const models=[{id:'claude-sonnet',name:'Sonnet'}]
  const section={ns:'providers',revision:1,value:{providers:{}}}
  const keys=new Map()
  let rejectSave=false
  const settings={
    describe:()=>[section],
    async mutate(ns,[change],revision){
      assert.equal(ns,section.ns)
      assert.equal(revision,section.revision)
      if(rejectSave) throw new Error('Conflict')
      const [key,route,field]=change.path
      assert.equal(key,'providers')
      if(field) section.value.providers[route][field]=change.value
      else section.value.providers[route]=change.value
      section.revision++
    },
  }
  const credentials={set:async(k,v)=>keys.set(k,v),unset:async k=>keys.delete(k),
    resolve:async k=>({value:keys.get(k)}),describe:async k=>({configured:keys.has(k)})}
  const llm={listConfigurableProviders:()=>[{provider:'anthropic',settingsNs:section.ns}],
    async discoverModels(_ns,args){
      if(args.apiKey==='invalid-test-key') throw new Error('Invalid')
      return models
    }}
  const accounts=apiAccounts({llm,get:key=>({settings,credentials})[key]})
  await assert.rejects(accounts.write('add-api',{name:'Invalid',key:'invalid-test-key'}),/Could not verify/)
  await accounts.write('add-api',{name:'One',key:'first-test-key'})
  await accounts.write('add-api',{name:'Two',key:'second-test-key'})
  await assert.rejects(accounts.write('add-api',{name:'Duplicate',key:'first-test-key'}),/already connected/)
  const initial=await accounts.list()
  assert.notEqual(initial[0].id,initial[1].id)
  await accounts.write('rename-api',{id:initial[0].id,name:'Renamed'})
  assert.equal((await accounts.list())[0].picker,'Claude API key · Renamed')
  assert.doesNotMatch(JSON.stringify(await accounts.list()),/test-key/)
  assert.doesNotMatch(JSON.stringify(section.value),/test-key/)
  rejectSave=true
  await assert.rejects(accounts.write('add-api',{name:'Conflict',key:'third-test-key'}),/Conflict/)
  assert.deepEqual([...keys.values()],['first-test-key','second-test-key'])
})

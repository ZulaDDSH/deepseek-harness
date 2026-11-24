import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hasBridge, setup } from './harness.mjs'

test('renaming subscriptions updates both picker groups and survives reload', { skip: !hasBridge }, async (t) => {
  const h=await setup(t,{ dirs:['Work'], signedIn:[['main','one@example.test'],['Work','two@example.test']] })
  await h.call('rename',{ id:'main',name:'Personal Max' })
  await h.call('rename',{ id:'work',name:'Studio' })
  assert.equal(h.ctx.llm.listProviders().find(provider=>provider.id==='claude-code-session').name,'(Claude Code) Subscription · Personal Max')
  assert.equal(h.ctx.llm.listProviders().find(provider=>provider.id==='claude-sub-work').name,'(Claude Code) Subscription · Studio')
  assert.equal((await h.raw('rename',{ id:'missing',name:'Unknown' })).ok,false)
  await h.manager.dispose()
  h.manager=await h.ctx.plugin(h.plugin)
  assert.equal((await h.call('list')).accounts.find(account=>account.id==='work').name,'Studio')
})

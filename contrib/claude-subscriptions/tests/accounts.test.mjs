import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hasBridge, setup } from './harness.mjs'

test('browser sign-in registers one model route per distinct account across restarts', { skip: !hasBridge }, async (t) => {
  const h = await setup(t, {
    dirs: ['Work', 'Personal'],
    signedIn: [
      ['main', 'one@example.test'],
      ['Personal', 'ONE@example.test'],
      ['Work', 'two@example.test'],
    ],
  })
  const { accounts, logouts, children, providers, visible, call } = h
  const work = h.dir('Work')
  const another = h.dir('Another')
  assert.equal((await h.guest('add', { label: 'Guest' })).ok, false)
  assert.deepEqual(await visible(), ['main', 'work'])
  assert.deepEqual(logouts, [h.dir('Personal')])
  assert.deepEqual(providers(), ['claude-code-session', 'claude-sub-work'])

  const added = await call('add', { label: 'Another' })
  assert.ok(added.accounts.find((a) => a.id === 'another').pending)
  accounts.set(another, { email: 'TWO@example.test' })
  children.get(another).emit('close', 0)
  assert.match((await call('list')).notice, /already connected as Work/)
  assert.equal((await call('list')).notice, '')
  assert.deepEqual(providers(), ['claude-code-session', 'claude-sub-work'])
  assert.ok(!accounts.has(another))
  await h.manager.dispose()
  assert.deepEqual(providers(), ['claude-code-session'])
  h.manager = await h.ctx.plugin(h.plugin)
  assert.deepEqual(await visible(), ['main', 'work'])

  await call('add', { label: 'Another' })
  accounts.set(another, { email: 'three@example.test' })
  children.get(another).emit('close', 0)
  assert.deepEqual(await visible(), ['another', 'main', 'work'])
  assert.ok(providers().includes('claude-sub-another'))
  accounts.set(work, { email: 'one@example.test' })
  assert.deepEqual(await visible(), ['another', 'main'])
  assert.ok(!providers().includes('claude-sub-work'))
  assert.ok(accounts.has(h.main))

  accounts.set(work, { email: 'one@example.test', org: 'second-organisation' })
  assert.deepEqual(await visible(), ['another', 'main', 'work'])
  assert.ok(providers().includes('claude-sub-work'))
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import React from 'react'
import TestRenderer from 'react-test-renderer'

let plugin
globalThis.window = {
  __ModuleLoader__: {
    load(definition) {
      plugin = definition.factory((name) => {
        assert.equal(name, 'react')
        return React
      })
    },
  },
}
await import('../client.js')

function register() {
  const components = new Map()
  plugin.apply({
    get: () => ({ rpc: {} }),
    effect: () => {},
    slots: {
      inject: (_name, mount) => mount(),
      register: (slot, component) => components.set(slot.name, component),
    },
  })
  return components
}

test('both settings locations offer browser sign-in and report the existing profile', async () => {
  const main = {
    id: 'main',
    picker: 'Claude subscription (Claude Code)',
    signedIn: true,
    email: 'one@example.test',
  }
  const notice = 'This Claude account is already connected as Main.'
  const calls = []
  const rpc = {
    async call(channel, method, args) {
      assert.equal(channel, '/claude-subscription-accounts')
      calls.push([method, args.label])
      return { ok: true, value: { accounts: [main], notice: method === 'add' ? notice : '' } }
    },
  }
  const components = register()
  assert.deepEqual([...components.keys()], ['settings.section', 'settings.models.footer'])
  const { act, create } = TestRenderer
  let page
  await act(async () => {
    page = create(React.createElement(components.get('settings.section'), { rpc }))
  })
  try {
    const field = page.root.findByProps({ 'aria-label': 'Account name' })
    const submit = () => page.root.findByProps({ type: 'submit' })
    assert.equal(submit().props.disabled, true)
    act(() => field.props.onChange({ target: { value: 'Work' } }))
    assert.equal(submit().props.disabled, false)
    await act(async () => {
      page.root.findByType('form').props.onSubmit({ preventDefault() {} })
    })
    assert.deepEqual(calls, [
      ['list', undefined],
      ['add', 'Work'],
    ])
    assert.equal(page.root.findByProps({ role: 'status' }).children[0], notice)
    assert.equal(page.root.findAllByType('strong').length, 1)
    assert.equal(field.props.value, '')
  } finally {
    act(() => page.unmount())
  }
})

test('pending sign-ins are polled with a growing delay that stops once nothing is pending', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let pending = true
  let lists = 0
  const rpc = {
    async call(_channel, method) {
      if (method === 'list') lists++
      return {
        ok: true,
        value: { accounts: [{ id: 'work', picker: 'Work', label: 'Work', signedIn: false, pending }], notice: '' },
      }
    },
  }
  const { act, create } = TestRenderer
  let page
  await act(async () => {
    page = create(React.createElement(register().get('settings.section'), { rpc }))
  })
  t.after(() => act(() => page.unmount()))
  const advance = async (ms) => {
    await act(async () => {
      t.mock.timers.tick(ms)
    })
  }
  assert.equal(lists, 1)
  await advance(2999)
  assert.equal(lists, 1)
  await advance(1)
  assert.equal(lists, 2)
  await advance(5999)
  assert.equal(lists, 2)
  await advance(1)
  assert.equal(lists, 3)
  await advance(12000)
  assert.equal(lists, 4)
  await advance(24000)
  assert.equal(lists, 5)
  await advance(29999)
  assert.equal(lists, 5)
  await advance(1)
  assert.equal(lists, 6)
  await advance(30000)
  assert.equal(lists, 7)
  pending = false
  await advance(30000)
  assert.equal(lists, 8)
  await advance(300000)
  assert.equal(lists, 8)
})

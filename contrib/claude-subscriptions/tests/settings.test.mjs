import assert from 'node:assert/strict'
import { test } from 'node:test'
import React from 'react'
import TestRenderer from 'react-test-renderer'

test('both settings locations offer browser sign-in and report the existing profile', async () => {
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
  const components = new Map()
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
  plugin.apply({
    get: () => ({ rpc }),
    effect: () => {}, // CSS is owned by the browser renderer.
    slots: {
      inject: (_name, mount) => mount(),
      register: (slot, component) => components.set(slot.name, component),
    },
  })
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
    delete globalThis.window
  }
})

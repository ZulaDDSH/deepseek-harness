// @vitest-environment jsdom
import { expect } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { ok } from '@deepseek-ai/dsh-remote-mock'
import { createClientTest, webApp } from '@deepseek-ai/dsh-client-test-runtime/src/assembly/index.ts'

const it = createClientTest({ roster: webApp.closure(['@deepseek-ai/dsh-client-ui-master-control', '@deepseek-ai/dsh-client-ui-commands']) })

it('loads the Master Control page and transports discovery, import, and home through the real client services', async ({ mock, start }) => {
  const id = SessionId('master-control-home-test')
  mock.load({ unary: {
    'session/masterHome': ok({ sessionId: id, agentPreset: 'master' }),
    'session/externalChats': ok({ items: [], limited: true }),
    'session/importChats': ok({ items: [] }),
    'session/list': ok({ items: [{ sessionId: id, updatedAt: 1, agentAvailable: true, running: false, blank: true }] }),
  } })
  const client = await start()
  const entry = client.ctx.slots.entries('main').find(row => row.options.key === 'master-control')!
  expect(entry).toBeDefined()
  expect(typeof entry.inject).toBe('function')
  expect(await client.ctx.sessions.externalChats()).toEqual({ items: [], limited: true })
  expect(await client.ctx.sessions.importChats([])).toEqual({ items: [] })
  expect(await client.ctx.sessions.masterHome()).toBe(id)
  expect(client.ctx.sessions.list.getSnapshot().byId[id]).toBeDefined()
}, 30000)

import assert from 'node:assert/strict'
import * as childProcess from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { LlmRuntime } from '@deepseek-ai/dsh-llm'
import { SessionStore } from '@deepseek-ai/dsh-session'

test('browser sign-in registers one model route per distinct account across restarts', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'harness-claude-test-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const root = join(home, 'harness', 'claude-accounts')
  const main = join(home, '.claude')
  const work = join(root, 'Work')
  const duplicate = join(root, 'Personal')
  for (const dir of [main, work, duplicate]) await mkdir(dir, { recursive: true })
  // Child process and environment mocks live only in this isolated test worker.
  process.env.USERPROFILE = process.env.HOME = home
  process.env.DSH_HOME = join(home, 'harness')
  process.env.PATH = home
  await writeFile(join(home, process.platform === 'win32' ? 'claude.exe' : 'claude'), '', { mode: 0o700 })
  const accounts = new Map([
    [main, 'one@example.test'],
    [duplicate, 'ONE@example.test'],
    [work, 'two@example.test'],
  ])
  const logouts = []
  const children = new Map()
  t.mock.module(new URL('../bridge/auth-process.js', import.meta.url).href, {
    namedExports: {
      createProcessAuthRunner: () => ({
        async run({ args, env }) {
          const dir = env.CLAUDE_CONFIG_DIR || main
          if (args[1] === 'logout') {
            assert.notEqual(dir, main)
            logouts.push(dir)
            accounts.delete(dir)
            return { exitCode: 0, stdout: '' }
          }
          const email = accounts.get(dir)
          const status = email
            ? {
                loggedIn: true,
                email,
                configDirectory: dir,
                authMethod: 'claude.ai',
                apiProvider: 'firstParty',
                orgId: dir,
              }
            : { loggedIn: false }
          return { exitCode: email ? 0 : 1, stdout: JSON.stringify(status) }
        },
      }),
    },
  })
  t.mock.module('node:child_process', {
    namedExports: {
      ...childProcess,
      spawn(exe, args, options) {
        assert.equal(options.cwd, options.env.CLAUDE_CONFIG_DIR)
        assert.ok(!Object.hasOwn(options.env, 'ANTHROPIC_API_KEY'))
        if (process.platform === 'win32') assert.match(args.at(-1), /"auth","login","--claudeai"/)
        else assert.deepEqual(args, ['auth', 'login', '--claudeai'])
        const child = new EventEmitter()
        children.set(options.cwd, child)
        return child
      },
    },
  })

  const ctx = new Context()
  const sessions = await ctx.plugin(SessionStore)
  const llm = await ctx.plugin(LlmRuntime)
  t.after(async () => {
    await llm.dispose()
    await sessions.dispose()
  })
  let handler
  ctx.provide('webServer', {})
  ctx.provide('connection', {
    rpc: {
      handle(channel, fn) {
        assert.equal(channel, '/claude-subscription-accounts')
        handler = fn
      },
    },
  })
  const bridge = await ctx.plugin(await import('../bridge/index.js'))
  t.after(() => bridge.dispose())
  const plugin = await import('../index.js')
  let manager = await ctx.plugin(plugin)
  t.after(() => manager.dispose())
  async function call(method, args = {}) {
    const response = await handler(method, { ...args, includeNotice: true }, undefined, {
      principal: { kind: 'owner' },
    })
    assert.equal(response.ok, true, response.error?.message)
    return response.value
  }
  const providers = () =>
    ctx.llm
      .listProviders()
      .map((p) => p.id)
      .sort()
  const visible = async () => (await call('list')).accounts.map((a) => a.id).sort()
  const denied = await handler('add', { label: 'Guest' }, undefined, { principal: { kind: 'guest' } })
  assert.equal(denied.ok, false)
  assert.deepEqual(await visible(), ['main', 'work'])
  assert.deepEqual(logouts, [duplicate])
  assert.deepEqual(providers(), ['claude-code-session', 'claude-sub-work'])

  const added = await call('add', { label: 'Another' })
  assert.ok(added.accounts.find((a) => a.id === 'another').pending)
  const another = join(root, 'Another')
  accounts.set(another, 'TWO@example.test')
  children.get(another).emit('close', 0)
  assert.match((await call('list')).notice, /already connected as Work/)
  assert.deepEqual(providers(), ['claude-code-session', 'claude-sub-work'])
  assert.ok(!accounts.has(another))
  await manager.dispose()
  assert.deepEqual(providers(), ['claude-code-session'])
  manager = await ctx.plugin(plugin)
  assert.deepEqual(await visible(), ['main', 'work'])

  await call('add', { label: 'Another' })
  accounts.set(another, 'three@example.test')
  children.get(another).emit('close', 0)
  assert.deepEqual(await visible(), ['another', 'main', 'work'])
  assert.ok(providers().includes('claude-sub-another'))
  accounts.set(work, 'one@example.test')
  assert.deepEqual(await visible(), ['another', 'main'])
  assert.ok(!providers().includes('claude-sub-work'))
  assert.ok(accounts.has(main))
})

import assert from 'node:assert/strict'
import * as childProcess from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import { LlmRuntime } from '@deepseek-ai/dsh-llm'
import { SessionStore } from '@deepseek-ai/dsh-session'

export const hasBridge = existsSync(new URL('../bridge/index.js', import.meta.url))

export async function setup(t, { signedIn = [], dirs = [] } = {}) {
  const home = await mkdtemp(join(tmpdir(), 'harness-claude-test-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const root = join(home, 'harness', 'claude-accounts')
  const main = join(home, '.claude')
  for (const dir of [main, ...dirs.map((d) => join(root, d))]) await mkdir(dir, { recursive: true })
  process.env.USERPROFILE = process.env.HOME = home
  process.env.DSH_HOME = join(home, 'harness')
  process.env.PATH = home
  await writeFile(join(home, process.platform === 'win32' ? 'claude.exe' : 'claude'), '', { mode: 0o700 })
  const accounts = new Map(signedIn.map(([dir, email, org]) => [dir === 'main' ? main : join(root, dir), { email, org }]))
  const logouts = []
  const children = new Map()
  const unreadable = new Set()
  let spawned = 0
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
          if (unreadable.has(dir)) return { exitCode: 0, stdout: 'Welcome to Claude Code' }
          const entry = accounts.get(dir)
          const status = entry
            ? {
                loggedIn: true,
                email: entry.email,
                configDirectory: dir,
                authMethod: 'claude.ai',
                apiProvider: 'firstParty',
                orgId: entry.org ?? 'org-' + entry.email.toLowerCase(),
              }
            : { loggedIn: false }
          return { exitCode: entry ? 0 : 1, stdout: JSON.stringify(status) }
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
        child.killed = false
        child.kill = () => {
          child.killed = true
        }
        spawned++
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
  const state = { handler: undefined }
  ctx.provide('webServer', {})
  ctx.provide('connection', {
    rpc: {
      handle(channel, fn) {
        assert.equal(channel, '/claude-subscription-accounts')
        state.handler = fn
      },
    },
  })
  const bridge = await ctx.plugin(await import('../bridge/index.js'))
  t.after(() => bridge.dispose())
  const plugin = await import('../index.js')
  const harness = {
    home,
    root,
    main,
    accounts,
    logouts,
    children,
    unreadable,
    ctx,
    plugin,
    spawned: () => spawned,
    dir: (label) => join(root, label),
    manager: await ctx.plugin(plugin),
    async raw(method, args = {}) {
      return state.handler(method, { ...args, includeNotice: true }, undefined, { principal: { kind: 'owner' } })
    },
    guest: (method, args = {}) => state.handler(method, args, undefined, { principal: { kind: 'guest' } }),
    async call(method, args = {}) {
      const response = await harness.raw(method, args)
      assert.equal(response.ok, true, response.error?.message)
      return response.value
    },
    providers: () =>
      ctx.llm
        .listProviders()
        .map((p) => p.id)
        .sort(),
    visible: async () => (await harness.call('list')).accounts.map((a) => a.id).sort(),
  }
  t.after(() => harness.manager.dispose())
  return harness
}

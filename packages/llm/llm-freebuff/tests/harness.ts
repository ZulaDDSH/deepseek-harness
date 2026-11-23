import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import AuthorizationService from '@deepseek-ai/dsh-authorization'
import { brandString } from '@deepseek-ai/dsh-brand'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import LlmRuntime, { type MessageId, type RequestMessage, type StreamChunk } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { afterEach } from 'vitest'
import { FreebuffAccount } from '../src/auth.ts'
import { DEFAULT_TIMING, type FreebuffEnvironment, type FreebuffTiming } from '../src/environment.ts'
import { installFreebuff } from '../src/install.ts'
import type { FreebuffQuotaOptions } from '../src/quota.ts'
import type { FreebuffPool } from '../src/session.ts'
import { FakeFreebuff } from './fake-terminal.ts'

export const FAKE_CLI = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures/fake-cli.mjs')

export const FAST: FreebuffTiming = {
  ...DEFAULT_TIMING,
  doctorTtlMs: 0,
  pollMs: 10,
  pasteSettleMs: 5,
  quietMs: 40,
  startupTimeoutMs: 3_000,
  interruptWaitMs: 150,
  graceMs: 20,
  loginTimeoutMs: 30_000,
}

const contexts: Context[] = []
const roots: string[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

export function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-llm-freebuff-'))
  roots.push(root)
  return root
}

export interface Harness {
  readonly ctx: Context
  readonly host: FakeFreebuff
  readonly root: string
  readonly state: string
  readonly environment: FreebuffEnvironment
  readonly account: FreebuffAccount
  readonly settingsCalls: unknown[][]
  pool(): FreebuffPool
  workspace(name: string, parent?: string): string
  session(id: string, cwd: string): SessionId
}

export interface HarnessOptions {
  readonly timing?: Partial<FreebuffTiming>
  readonly loginExit?: string
  readonly mode?: string
  readonly install?: boolean
  readonly quota?: FreebuffQuotaOptions
  readonly signedIn?: boolean
  readonly sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access'
  readonly idleReapMs?: number
  readonly emptyConfig?: boolean
  readonly resolveExecutable?: () => Promise<string>
}

export async function harness(options: HarnessOptions = {}): Promise<Harness> {
  const root = scratch()
  const state = join(root, 'state.txt')
  writeFileSync(state, options.signedIn === false ? 'out' : 'in')
  const host = new FakeFreebuff(join(root, 'config'))
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LocalCredentialProvider, { path: join(root, '.credentials.yaml'), watch: false })
  await ctx.plugin(AuthorizationService)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(LocalSubprocessRuntime)
  const sessions = new Map<string, { id: string, cwd: string }>()
  ctx.provide('sessions', { get: (id: string) => sessions.get(id) } as never)
  ctx.provide('workingDirectory', { get: (session: { cwd: string }) => session.cwd } as never)
  if (options.sandbox !== undefined) {
    ctx.provide('sandboxPolicy', { resolve: () => ({ mode: options.sandbox, workspaceRoot: root }) } as never)
  }
  const settingsCalls: unknown[][] = []
  ctx.provide('settings', { configure: (...args: unknown[]) => { settingsCalls.push(args); return () => {} } } as never)
  const environment: FreebuffEnvironment = {
    resolveExecutable: options.resolveExecutable ?? (() => Promise.resolve(process.execPath)),
    args: [FAKE_CLI, state, options.loginExit ?? '0', options.mode ?? 'normal'],
    env: {},
    configDir: host.configDir,
    homeDir: root,
    platform: process.platform,
    comSpec: process.env.ComSpec,
    timing: { ...FAST, ...options.timing },
  }
  let mounted: FreebuffPool | undefined
  if (options.install !== false) {
    await ctx.plugin({
      name: 'llm-freebuff-test',
      inject: ['authorization', 'credentials', 'llm', 'sessions', 'subprocess', 'workingDirectory'],
      apply: (child: Context) => {
        mounted = installFreebuff(child, options.emptyConfig === true ? {} : { idleReapMs: { get: () => options.idleReapMs ?? 60_000 } as never }, {
          environment,
          spawnTerminal: host.spawnTerminal,
          ...options.quota === undefined ? {} : { quota: options.quota },
        })
      },
    } as never, {} as never)
  }
  return {
    ctx,
    host,
    root,
    state,
    environment,
    account: new FreebuffAccount(ctx, environment),
    settingsCalls,
    pool: () => mounted as FreebuffPool,
    workspace: (name, parent = root) => {
      const path = join(parent, name)
      mkdirSync(path, { recursive: true })
      return path
    },
    session: (id, cwd) => {
      sessions.set(id, { id, cwd })
      return brandString<SessionId>(id)
    },
  }
}

export function userMessage(text: string): RequestMessage {
  return { role: 'user', content: [{ type: 'text', text }] }
}

export function assistantMessage(text: string, replayState: unknown): RequestMessage {
  return {
    id: brandString<MessageId>('m'),
    role: 'assistant',
    content: [{ type: 'text', text }],
    source: { kind: 'model', provider: 'freebuff', model: 'default', replayState },
  }
}

export interface Collected {
  readonly chunks: StreamChunk[]
  readonly text: string
  readonly finish: Extract<StreamChunk, { type: 'finish' }>
}

export async function collect(h: Harness, sessionId: SessionId | undefined, messages: RequestMessage[], extra: { signal?: AbortSignal, purpose?: string } = {}): Promise<Collected> {
  const chunks: StreamChunk[] = []
  for await (const chunk of h.ctx.llm.stream({
    provider: 'freebuff',
    model: 'default',
    messages,
    ...sessionId === undefined ? {} : { sessionId },
    ...extra.signal === undefined ? {} : { signal: extra.signal },
    ...extra.purpose === undefined ? {} : { purpose: extra.purpose as never },
  })) chunks.push(chunk)
  const finish = chunks.at(-1)
  if (finish?.type !== 'finish') throw new Error('stream did not end with finish')
  const text = chunks.flatMap(chunk => chunk.type === 'text-delta' ? [chunk.text] : []).join('')
  return { chunks, text, finish }
}

export function failureOf(result: Collected): { message: string, code: string } {
  if (result.finish.reason.kind !== 'error' && result.finish.reason.kind !== 'aborted') throw new Error(`expected a failure, got ${result.finish.reason.kind}`)
  return result.finish.reason.failure
}

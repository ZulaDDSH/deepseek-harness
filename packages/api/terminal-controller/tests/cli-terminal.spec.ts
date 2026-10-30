import { readdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PassThrough } from 'node:stream'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session/types'
import { SubprocessExecutableNotFoundError, type SubprocessTerminalHandle, type SubprocessTerminalSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CLI_TERMINAL_PROFILES, cliStartupArgv, cliTerminalProfile, type CliTerminalProfileId } from '../src/cli-profiles.ts'
import { TerminalController, type Config } from '../src/index.ts'
import { inputChannel } from './input.ts'
import type { PeerId, RemoteInvocation } from '@deepseek-ai/dsh-typert-protocol'
import type { TerminalInput, WebTerminalId } from '../src/types.ts'

const roots: Context[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose())) })
const config: Config = { shellCandidates: ['bash'], shell: { path: '/bin/bash', name: 'bash', args: ['--noprofile', '--norc', '-i'] }, maxTerminals: 2, maxCols: 200, maxRows: 100, scrollback: 100, maxBufferedBytes: 100_000, maxInputBytes: 1000, disposeGraceMs: 100, unattendedTimeoutMs: 7_200_000, activityPollIntervalMs: 30_000, cleanupRetryMs: 60_000 }
const id = 'cli-terminal' as WebTerminalId
const request = { id, cols: 80, rows: 24 }
const signal = (): AbortSignal => new AbortController().signal

type AgentFake = Partial<Omit<Agent, 'session' | 'inbox'>> & { session?: Partial<Agent['session']>; inbox?: Partial<Agent['inbox']> }
function agentFake(fields: AgentFake): Agent { return fields as Agent }

function session(ctx: Context, profile?: CliTerminalProfileId): Agent {
  const hosted: Partial<Agent['session']> & { cliProfile?: CliTerminalProfileId | undefined } = { id: 'session' as SessionId, header: { version: SESSION_FORMAT_VERSION, id: 'session' as SessionId, createdAt: 0, isSeeded: false, cwd: '/workspace' }, cliProfile: profile }
  return agentFake({ id: 'session' as SessionId, ctx, session: hosted })
}

function fixture() {
  const ctx = new Context()
  roots.push(ctx)
  ctx.provide('sandboxPolicy', { defaultMode: 'danger-full-access', workspaceRoot: '/workspace', resolve: vi.fn(() => ({ mode: 'danger-full-access', workspaceRoot: '/workspace' })) } as never)
  const output = new PassThrough()
  const done = Promise.withResolvers<{ exitCode: number; signal: null }>()
  const handle = {
    pid: 123, output, done: done.promise,
    write: vi.fn(async (_data: string) => {}), resize: vi.fn(async (_cols: number, _rows: number) => {}),
    inspectActivity: vi.fn(async () => ({ state: 'unknown' as const, revision: 0 })),
    inspectForeground: async () => undefined, signalForeground: async () => 123,
    terminate: vi.fn(async () => { output.end(); done.resolve({ exitCode: 0, signal: null }) }),
  }
  const subprocess = {
    inheritsUserEnvironment: true,
    terminalEnvironment: vi.fn(async () => ({ platform: 'posix' as const, defaultShell: '/bin/bash' })),
    resolveExecutable: vi.fn(async (path: string) => path),
    spawnTerminal: vi.fn(async (_spec: SubprocessTerminalSpawnSpec) => handle as SubprocessTerminalHandle),
  }
  ctx.provide('subprocess', subprocess as never)
  ctx.provide('workingDirectory', {
    get: (session: Agent['session']) => session.header.cwd ?? '/workspace',
    ensure: async (agent: Agent) => agent.session.header.cwd ?? '/workspace',
  } as never)
  ctx.provide('sessionProjections', {
    snapshot: (hosted: { cliProfile?: CliTerminalProfileId }) => ({
      asOfSeq: -1,
      values: { cliTerminal: { profile: hosted.cliProfile ?? null } },
    }),
  } as never)
  return { ctx, controller: new TerminalController(ctx, config), subprocess, handle }
}

function attachController(agent: Agent, terminalId: WebTerminalId, signal: AbortSignal, input: AsyncIterable<unknown>) {
  const invocation: RemoteInvocation = {
    request: { namespace: 'terminal', method: 'attach', args: {} }, service: 'terminalController', signal,
    peer: { id: 'test-peer' as PeerId, ctx: agent.ctx, principal: { kind: 'owner' }, interactions: 'answer', signal, dispose: async () => {} },
    uplink: <In>() => input as AsyncIterable<In>,
  }
  return agent.ctx.extend({ invocation }).terminalController.attach(agent, terminalId, signal)
}

function sourcesUnder(directories: string[]): string[] {
  return directories.flatMap((directory) => {
    const root = fileURLToPath(new URL(directory, import.meta.url))
    return readdirSync(root, { recursive: true, encoding: 'utf8' }).filter(file => file.endsWith('.ts')).map(file => join(root, file))
  })
}

function hostSources(): string[] {
  return sourcesUnder(['../src', '../../session-controller/src', '../../../subprocess/subprocess-local/src', '../../../subprocess/subprocess/src'])
}

describe('CLI terminal profiles', () => {
  it('pins the user-run CLIs to fixed commands and vendor install pages', () => {
    expect(CLI_TERMINAL_PROFILES.map(({ id, command }) => [id, command])).toEqual([
      ['gemini-cli', 'gemini'], ['grok-cli', 'grok'], ['cursor-cli', 'cursor-agent'],
    ])
    for (const profile of CLI_TERMINAL_PROFILES) expect(profile.installUrl).toMatch(/^https:\/\//u)
    expect(() => cliTerminalProfile('unknown')).toThrow('Unknown CLI terminal profile')
  })

  it.each(CLI_TERMINAL_PROFILES)('$id starts its command with no profile flags for each shell family', (profile) => {
    expect(cliStartupArgv('C:\\Program Files\\PowerShell\\7\\pwsh.exe', profile))
      .toEqual(['C:\\Program Files\\PowerShell\\7\\pwsh.exe', '-NoLogo', '-NoExit', '-Command', profile.command])
    expect(cliStartupArgv('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', profile))
      .toEqual(['C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', '-NoLogo', '-NoExit', '-Command', profile.command])
    expect(cliStartupArgv('C:\\Windows\\System32\\cmd.exe', profile)).toEqual(['C:\\Windows\\System32\\cmd.exe', '/k', profile.command])
    expect(cliStartupArgv('/bin/zsh', profile)).toEqual(['/bin/zsh', '-i', '-c', `${profile.command}; exec "$0" -i`, '/bin/zsh'])
    expect(cliStartupArgv('/usr/bin/fish', profile)).toEqual(['/usr/bin/fish', '-i', '-c', profile.command])
  })
})

describe('TerminalController CLI terminals', () => {
  it.each(CLI_TERMINAL_PROFILES)('$id runs its command in the default shell with the inherited environment and no DSH overlay', async (profile) => {
    const { ctx, controller, subprocess } = fixture()
    const created = await controller.create(session(ctx, profile.id), { ...request, cli: profile.id }, signal())
    const [spec] = subprocess.spawnTerminal.mock.calls[0] ?? []
    expect(spec).toEqual(expect.objectContaining({
      argv: cliStartupArgv('/bin/bash', profile), cwd: '/workspace', cols: 80, rows: 24, inheritEnvironment: true, shellActivity: false,
    }))
    expect(spec).not.toHaveProperty('env')
    expect(created).toMatchObject({
      title: profile.command, cli: { profile: profile.id, command: profile.command, installed: true, installUrl: profile.installUrl },
    })
    await controller.close(session(ctx, profile.id), id)
  })

  it.each(CLI_TERMINAL_PROFILES)('$id keeps its install hint and still opens the shell when the command is missing', async (profile) => {
    const { ctx, controller, subprocess } = fixture()
    subprocess.resolveExecutable.mockImplementation(async (path: string) => {
      if (path === profile.command) throw new SubprocessExecutableNotFoundError(`${path} not found`)
      return path
    })
    const created = await controller.create(session(ctx, profile.id), { ...request, cli: profile.id }, signal())
    expect(created.cli).toEqual({ profile: profile.id, command: profile.command, installed: false, installUrl: profile.installUrl })
    expect(subprocess.spawnTerminal).toHaveBeenCalledOnce()
    await controller.close(session(ctx, profile.id), id)
  })

  it('reports each CLI profile as installed or not from the Session environment', async () => {
    const { ctx, controller, subprocess } = fixture()
    subprocess.resolveExecutable.mockImplementation(async (path: string) => {
      if (path === 'grok') throw new SubprocessExecutableNotFoundError('grok not found')
      return path
    })
    await expect(controller.cliProfiles(session(ctx), signal())).resolves.toEqual([
      { profile: 'gemini-cli', installed: true, installUrl: 'https://geminicli.com' },
      { profile: 'grok-cli', installed: false, installUrl: 'https://x.ai/cli' },
      { profile: 'cursor-cli', installed: true, installUrl: 'https://cursor.com/cli' },
    ])
  })

  it('offers no CLI profile and refuses a CLI terminal where the provider cannot inherit the user environment', async () => {
    const { ctx, controller, subprocess } = fixture()
    subprocess.inheritsUserEnvironment = false
    await expect(controller.cliProfiles(session(ctx), signal())).resolves.toEqual([])
    await expect(controller.create(session(ctx, 'gemini-cli'), { ...request, cli: 'gemini-cli' }, signal()))
      .rejects.toThrow('only in a local execution environment')
    expect(subprocess.spawnTerminal).not.toHaveBeenCalled()
  })

  it('rejects a CLI request unless the Session was created for that profile', async () => {
    const { ctx, controller, subprocess } = fixture()
    await expect(controller.create(session(ctx, 'gemini-cli'), { ...request, cli: 'grok-cli' }, signal()))
      .rejects.toMatchObject({ code: 'terminal/cli-session-mismatch' })
    await expect(controller.create(session(ctx), { ...request, cli: 'gemini-cli' }, signal()))
      .rejects.toMatchObject({ code: 'terminal/cli-session-mismatch' })
    expect(subprocess.spawnTerminal).not.toHaveBeenCalled()
  })

  it('writes to the PTY only through uplink input from the attached writer', async () => {
    const { ctx, controller, handle } = fixture()
    const agent = session(ctx, 'cursor-cli')
    await controller.create(agent, { ...request, cli: 'cursor-cli' }, signal())
    expect(handle.write).not.toHaveBeenCalled()
    const input = inputChannel<TerminalInput>()
    const stream = attachController(agent, id, signal(), input.source)[Symbol.asyncIterator]()
    await stream.next()
    input.push({ type: 'write', sequence: 1, data: 'ls\r' })
    expect((await stream.next()).value).toMatchObject({ type: 'ack', sequence: 1 })
    expect(handle.write).toHaveBeenCalledOnce()
    expect(handle.write).toHaveBeenCalledWith('ls\r')
    await stream.return?.()
    await controller.close(agent, id)
  })

  it('confines PTY write and resize calls in host source to the terminal input path', () => {
    const sites = hostSources().flatMap(file => readFileSync(file, 'utf8').split('\n')
      .filter(line => /handle\.(write|resize)\(/u.test(line))
      .map(() => basename(file)))
    expect(sites.sort()).toEqual(['terminal.ts', 'terminal.ts'])
  })

  it('never names the agent CLIs credential or config folders in host source', () => {
    const forbidden = /['"`/\\]\.(gemini|grok|cursor)\b|GROK_HOME|cursor-agent[\\/]/u
    expect(hostSources().filter(file => forbidden.test(readFileSync(file, 'utf8')))).toEqual([])
  })

  it('keeps the agent-accessible terminal tools off the terminal controller', () => {
    const tools = sourcesUnder(['../../../terminal/terminal-bash/src', '../../../experimental/tool-terminal/src'])
    expect(tools.length).toBeGreaterThan(0)
    expect(tools.filter(file => /terminal-controller|terminalController/u.test(readFileSync(file, 'utf8')))).toEqual([])
  })
})

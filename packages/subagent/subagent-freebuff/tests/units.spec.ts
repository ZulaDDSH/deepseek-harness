import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { PassThrough } from 'node:stream'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SubprocessHandle, SubprocessSpawnSpec, SubprocessTerminalSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import Runtime from '@deepseek-ai/dsh-subprocess-local'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  FREEBUFF_LOGIN_COMMAND,
  FreebuffNotInstalledError,
  FreebuffNotLoggedInError,
  FreebuffRunFailure,
} from '../src/errors.ts'
import { checkFreebuffLogin, doctorCommand, freebuffLoginFailure, launchCommand } from '../src/login.ts'
import { startFreebuffRun, taskText, type FreebuffRunSpec } from '../src/run.ts'
import { classifyScreen, FreebuffScreen, screenAnswer } from '../src/screen.ts'
import { findChatFile, freebuffConfigDir, readTranscript } from '../src/transcript.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-freebuff-units-'))
  roots.push(root)
  return root
}

const READY = ['Freebuff', '', '/model to change  |  for history']
const BUSY = ['> task', '', 'thinking...', '■ Esc']

describe('classifyScreen', () => {
  it('recognises the ready footer', () => {
    expect(classifyScreen(READY.join('\n'))).toMatchObject({ ready: true, busy: false, loginRequired: false })
  })

  it.each(BUSY.slice(2))('recognises the busy marker %s', (marker) => {
    expect(classifyScreen(['> task', marker].join('\n'))).toMatchObject({ busy: true, ready: false })
  })

  it.each(['Press ENTER to login...', 'Open this URL in your browser to login:', 'Waiting for login...', 'Your session appears to be invalid. Please log in again'])(
    'recognises the login screen %s',
    (line) => {
      expect(classifyScreen(['Welcome', line].join('\n')).loginRequired).toBe(true)
    },
  )

  it('recognises the trust prompt', () => {
    expect(classifyScreen('Load and run these? [y/N] ').trustPrompt).toBe(true)
  })

  it.each(['Enter: confirm and send', 'Enter: take over', 'Enter: choose another model', 'Enter: retry'])(
    'reports the admission prompt %s',
    (line) => {
      expect(classifyScreen(['Session', line, 'Esc: back to draft'].join('\n')).blocker).toBe(line)
    },
  )

  it('ignores a busy marker quoted in the upper part of an answer', () => {
    const answer = ['thinking... is shown while a turn runs', ...Array.from({ length: 10 }, (_, index) => `line ${index}`), ...READY]
    expect(classifyScreen(answer.join('\n'))).toMatchObject({ busy: false, ready: true })
  })

  it('treats only the status line as busy, not an answer line that mentions the indicator', () => {
    const rows = (line: string): string => ['> task', line, ...Array.from({ length: 4 }, (_, index) => `row ${index}`), ...READY].join('\n')
    expect(classifyScreen(rows('I was thinking... about it')).busy).toBe(false)
    expect(classifyScreen(rows('working... on the report is the next step')).busy).toBe(false)
    expect(classifyScreen(rows(' thinking...                                              1s  ■ Esc')).busy).toBe(true)
    expect(classifyScreen(rows(' ⠋ working... 12s')).busy).toBe(true)
  })

  it('finds a busy status line above a three row footer and an input box', () => {
    const screen = ['answer', ' thinking...      1s  ■ Esc', '╭──╮', '│  │', '│ ▍Add to the current task │', '│  │', '╰──╯', ' DeepSeek · /model to change · Chat: x', ' wrapped chat title', ' ← for history · ? for help']
    expect(classifyScreen(screen.join('\n'))).toMatchObject({ busy: true, ready: true })
  })

  it('ignores login and prompt markers that the task itself contains, and markers above the bottom rows', () => {
    const task = 'Explain Press ENTER to login... and Enter: take over'
    const echoed = ['> Explain Press ENTER to login... and Enter: take over', ' Chat: Explain Press ENTER to login...', ...READY]
    expect(classifyScreen(echoed.join('\n'), task)).toMatchObject({ loginRequired: false, blocker: undefined })
    expect(classifyScreen(echoed.join('\n'))).toMatchObject({ loginRequired: true, blocker: 'Enter: take over' })
    const quotedHigh = ['Enter: retry', ...Array.from({ length: 20 }, (_, index) => `line ${index}`), ...READY]
    expect(classifyScreen(quotedHigh.join('\n'), 'other task').blocker).toBeUndefined()
    expect(classifyScreen(['> other task', 'Session in use', 'Enter: take over', ...READY].join('\n'), 'other task').blocker).toBe('Enter: take over')
  })

  it('reports an empty screen as neither ready nor busy', () => {
    expect(classifyScreen('')).toEqual({
      loginRequired: false,
      trustPrompt: false,
      blocker: undefined,
      busy: false,
      ready: false,
    })
  })
})

describe('screenAnswer', () => {
  it('returns the text after the echoed task without the status chrome', () => {
    const screen = ['> do the thing', '', 'First answer line', 'Second answer line', '', '/model to change  |  for history', '✕ End session'].join('\n')
    expect(screenAnswer(screen, 'do the thing\nmore detail')).toEqual({ text: 'First answer line\nSecond answer line', clipped: false })
  })

  it('keeps the whole screen text and flags it as clipped when the task echo is not found', () => {
    expect(screenAnswer(['Only line', '/model to change  |  for history'].join('\n'), 'missing')).toEqual({ text: 'Only line', clipped: true })
  })

  it('does not anchor on an empty task', () => {
    expect(screenAnswer('answer', '')).toEqual({ text: 'answer', clipped: false })
  })

  it('anchors on the echoed task rather than the footer chat title and drops the ad box and input box', () => {
    const screen = [
      'banner', '   [08:07 AM]', '   hi', 'PONG', ' ⎘ • 3s • △▽',
      ' ╭──────╮', ' │ Sponsored │', ' ╰──────╯',
      ' 54.1K (5%)        ✕ End session',
      '╭──────╮', '│ ▍Enter a coding task │', '╰──────╯',
      ' DeepSeek · /model to change · Chat: hi', ' ← for history · ? for help',
    ].join('\n')
    expect(screenAnswer(screen, 'hi')).toEqual({ text: 'PONG', clipped: false })
  })
})

describe('FreebuffScreen', () => {
  it('renders written terminal output as text and forwards emulator replies', async () => {
    const replies: string[] = []
    const screen = new FreebuffScreen(40, 10, (data) => { replies.push(data) })
    screen.write('\x1b[?1049h\x1b[2J\x1b[Hhello\r\nworld\x1b[6n')
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(screen.text()).toBe('hello\nworld')
    expect(replies.join('')).toContain('\x1b[2;6R')
    screen.dispose()
  })
})

describe('taskText', () => {
  it('joins text blocks and removes control characters except newline and tab', () => {
    const prompt: ContentBlock[] = [{ type: 'text', text: 'a\x1b[201~b\r\nc\td' }, { type: 'text', text: 'second' }]
    expect(taskText(prompt)).toBe('a[201~b\nc\td\n\nsecond')
  })

  it.each(['/logout', '!rm -rf x', ' \n /model'])('rejects a task that starts a Freebuff command (%j)', (text) => {
    expect(() => taskText([{ type: 'text', text }])).toThrow('must not start with "/" or "!"')
  })

  it('accepts a task that only mentions a command later', () => {
    expect(taskText([{ type: 'text', text: 'run /logout? no. use ! carefully' }])).toBe('run /logout? no. use ! carefully')
  })

  it('rejects an empty task', () => {
    expect(() => taskText([{ type: 'text', text: ' \n ' }])).toThrow('must not be empty')
    expect(() => taskText([])).toThrow('must not be empty')
  })

  it('rejects a non-text block', () => {
    const image = { type: 'image', mediaType: 'image/png', data: 'AAAA' } as never
    expect(() => taskText([image])).toThrow('only text blocks')
  })
})

describe('freebuffLoginFailure', () => {
  const report = (...ids: string[]): string => JSON.stringify({ version: 1, findings: ids.map(id => ({ id, severity: 'info' })) })

  it.each(['auth.signed-out', 'auth.empty', 'auth.corrupt', 'auth.unreadable'])('reports %s as not logged in', (id) => {
    expect(freebuffLoginFailure(report('install.ok', id))).toBe(id)
  })

  it('accepts a signed-in report', () => {
    expect(freebuffLoginFailure(report('auth.ok', 'network.ok'))).toBeUndefined()
  })

  it('skips launcher text before the JSON report', () => {
    expect(freebuffLoginFailure(`updating...\n${report('auth.signed-out')}`)).toBe('auth.signed-out')
  })

  it.each(['', 'no json here', '{broken', '{"findings": "nope"}', '{"findings": [{"id": 3}]}'])('does not block on unusable output %j', (stdout) => {
    expect(freebuffLoginFailure(stdout)).toBeUndefined()
  })
})

describe('doctorCommand', () => {
  it('runs doctor directly except for Windows batch shims', () => {
    expect(doctorCommand('/usr/bin/freebuff', 'linux', undefined)).toEqual({ argv: ['/usr/bin/freebuff', 'doctor', '--json'], env: {} })
    expect(doctorCommand('C:\\bin\\freebuff.exe', 'win32', 'cmd.exe')).toEqual({ argv: ['C:\\bin\\freebuff.exe', 'doctor', '--json'], env: {} })
    expect(doctorCommand('C:\\bin\\freebuff.BAT', 'win32', undefined).argv[0]).toBe('cmd.exe')
  })

  it('passes a batch shim path through the environment so spaces and parentheses survive cmd quoting', () => {
    const command = doctorCommand('C:\\Program Files (x86)\\Free buff\\freebuff.cmd', 'win32', 'C:\\Windows\\System32\\cmd.exe')
    expect(command.argv).toEqual(['C:\\Windows\\System32\\cmd.exe', '/d', '/c', '%DSH_FREEBUFF_DOCTOR_EXE%', 'doctor', '--json'])
    expect(command.env).toEqual({ DSH_FREEBUFF_DOCTOR_EXE: '"C:\\Program Files (x86)\\Free buff\\freebuff.cmd"' })
  })

  it.runIf(process.platform === 'win32')('runs a real batch shim whose path contains spaces and parentheses', async () => {
    const shimDir = join(tempRoot(), 'Program Files (x86)', 'Free buff')
    mkdirSync(shimDir, { recursive: true })
    const shim = join(shimDir, 'freebuff.cmd')
    writeFileSync(shim, '@echo {"findings":[{"id":"auth.signed-out"}]}\r\n')
    const ctx = new Context()
    try {
      await ctx.plugin(Runtime)
      await expect(checkFreebuffLogin({
        spawn: spec => ctx.subprocess.spawn(spec),
        executable: shim,
        cwd: shimDir,
        env: {},
        timeoutMs: 20_000,
        graceMs: 500,
        signal: new AbortController().signal,
        platform: 'win32',
        comSpec: process.env.ComSpec,
      })).resolves.toBe('auth.signed-out')
    } finally {
      await ctx.fiber.dispose()
    }
  }, 30_000)
})

describe('checkFreebuffLogin', () => {
  function fakeSpawn(stdout: string | undefined, behaviour: 'exit' | 'reject' | 'throw' = 'exit') {
    const specs: SubprocessSpawnSpec[] = []
    const spawn = (spec: SubprocessSpawnSpec): SubprocessHandle => {
      specs.push(spec)
      if (behaviour === 'throw') throw new Error('spawn failed')
      return {
        done: behaviour === 'reject' ? Promise.reject(new Error('doctor failed')) : Promise.resolve({ exitCode: 1, signal: null }),
        collected: {
          stdout: stdout === undefined ? undefined : { readFrom: () => ({ text: stdout, nextOffset: stdout.length, lossy: false }) },
        },
      } as never
    }
    return { spawn, specs }
  }
  const base = {
    executable: '/bin/freebuff',
    cwd: '/work',
    env: { A: 'b' },
    timeoutMs: 1_000,
    graceMs: 100,
    signal: new AbortController().signal,
    platform: 'linux' as const,
    comSpec: undefined,
  }

  it('reports the signed-out finding from the doctor report and spawns without stdin or credentials', async () => {
    const { spawn, specs } = fakeSpawn(JSON.stringify({ findings: [{ id: 'auth.signed-out' }] }))
    await expect(checkFreebuffLogin({ ...base, spawn })).resolves.toBe('auth.signed-out')
    expect(specs[0]).toMatchObject({ argv: ['/bin/freebuff', 'doctor', '--json'], cwd: '/work', env: { A: 'b' }, stdio: { stdin: 'ignore' } })
  })

  it('accepts a signed-in report', async () => {
    const { spawn } = fakeSpawn(JSON.stringify({ findings: [{ id: 'auth.ok' }] }))
    await expect(checkFreebuffLogin({ ...base, spawn })).resolves.toBeUndefined()
  })

  it('does not block when doctor produced no output', async () => {
    await expect(checkFreebuffLogin({ ...base, spawn: fakeSpawn(undefined).spawn })).resolves.toBeUndefined()
  })

  it.each(['reject', 'throw'] as const)('does not block when doctor cannot run (%s)', async (behaviour) => {
    await expect(checkFreebuffLogin({ ...base, spawn: fakeSpawn('', behaviour).spawn })).resolves.toBeUndefined()
  })
})

describe('transcript', () => {
  function chat(configDir: string, cwdName: string, id: string, messages: unknown): string {
    const dir = join(configDir, 'projects', cwdName, 'chats', id)
    mkdirSync(dir, { recursive: true })
    const file = join(dir, 'chat-messages.json')
    writeFileSync(file, JSON.stringify(messages))
    return file
  }

  it('uses an absolute FREEBUFF_CONFIG_DIR and otherwise the default config directory', () => {
    expect(freebuffConfigDir({ FREEBUFF_CONFIG_DIR: tmpdir() }, '/home/u')).toBe(tmpdir())
    expect(freebuffConfigDir({ FREEBUFF_CONFIG_DIR: 'relative' }, '/home/u')).toBe(join('/home/u', '.config', 'manicode'))
    expect(freebuffConfigDir({}, '/home/u')).toBe(join('/home/u', '.config', 'manicode'))
  })

  it('finds the newest chat transcript of the task written since the run started', () => {
    const root = tempRoot()
    const mine = [{ variant: 'user', content: 'the task' }]
    const old = chat(root, 'proj', 'old', mine)
    const fresh = chat(root, 'proj', 'fresh', mine)
    const newer = chat(root, 'proj', 'newer', mine)
    const foreign = chat(root, 'proj', 'foreign', [{ variant: 'user', content: 'another task' }])
    utimesSync(foreign, new Date(9_000), new Date(9_000))
    utimesSync(old, new Date(1_000), new Date(1_000))
    utimesSync(fresh, new Date(5_000), new Date(5_000))
    utimesSync(newer, new Date(6_000), new Date(6_000))
    expect(findChatFile(root, join('/some', 'proj'), 4_000, 'the  task')).toBe(newer)
    expect(findChatFile(root, join('/some', 'proj'), 7_000, 'the task')).toBeUndefined()
    expect(findChatFile(root, join('/some', 'proj'), 4_000, 'unrelated')).toBeUndefined()
    expect(findChatFile(root, join('/some', 'other'), 0, 'the task')).toBeUndefined()
  })

  it('reads the final answer and completion from the last assistant message', () => {
    const root = tempRoot()
    const file = chat(root, 'proj', 'c', [
      { variant: 'user', content: 'earlier' },
      { variant: 'ai', content: 'earlier answer', isComplete: true },
      { variant: 'user', content: 'task' },
      { variant: 'ai', content: 'fallback', blocks: [
        { type: 'text', content: 'thinking aloud', textType: 'reasoning' },
        { type: 'tool', content: 'ignored' },
        { type: 'text', content: 'the answer', textType: 'text' },
      ], isComplete: true },
    ])
    expect(readTranscript(file)).toEqual({ complete: true, answer: 'the answer', error: undefined })
  })

  it('falls back to message content and reports an incomplete turn', () => {
    const root = tempRoot()
    const file = chat(root, 'proj', 'c', [
      { variant: 'user', content: 'task' },
      { variant: 'ai', content: 'partial ' },
    ])
    expect(readTranscript(file)).toEqual({ complete: false, answer: 'partial', error: undefined })
  })

  it('reports a user error and an error message', () => {
    const root = tempRoot()
    expect(readTranscript(chat(root, 'a', 'c', [
      { variant: 'user', content: 'task' },
      { variant: 'ai', content: 'x', userError: 'boom' },
    ]))?.error).toBe('boom')
    expect(readTranscript(chat(root, 'b', 'c', [
      { variant: 'user', content: 'task' },
      { variant: 'error', content: 'broke' },
    ]))?.error).toBe('broke')
  })

  it('ignores a user error that a later complete answer recovered from, but not one without it', () => {
    const root = tempRoot()
    const failed = { variant: 'ai', content: 'x', userError: 'transient' }
    expect(readTranscript(chat(root, 'a', 'c', [
      { variant: 'user', content: 'task' }, failed, { variant: 'ai', content: 'done', isComplete: true },
    ]))).toEqual({ complete: true, answer: 'done', error: undefined })
    expect(readTranscript(chat(root, 'b', 'c', [
      { variant: 'user', content: 'task' }, { variant: 'ai', content: 'done', isComplete: true }, failed,
    ]))?.error).toBe('transient')
    expect(readTranscript(chat(root, 'c', 'c', [
      { variant: 'user', content: 'task' }, failed, { variant: 'ai', content: 'partial' },
    ]))?.error).toBe('transient')
  })

  it('reports no transcript before the task, for non-arrays, and for unreadable files', () => {
    const root = tempRoot()
    expect(readTranscript(chat(root, 'a', 'c', [{ variant: 'ai', content: 'x' }]))).toBeUndefined()
    expect(readTranscript(chat(root, 'b', 'c', { messages: [] }))).toBeUndefined()
    expect(readTranscript(join(root, 'missing.json'))).toBeUndefined()
    expect(readTranscript(chat(root, 'c', 'c', [{ variant: 'user', content: 'task' }]))).toEqual({
      complete: false,
      answer: '',
      error: undefined,
    })
  })
})

describe('typed errors', () => {
  it('names the login command and carries stable codes', () => {
    const loggedOut = new FreebuffNotLoggedInError('doctor: auth.signed-out')
    expect(loggedOut.code).toBe('FREEBUFF_NOT_LOGGED_IN')
    expect(loggedOut.message).toContain(`\`${FREEBUFF_LOGIN_COMMAND}\``)
    expect(new FreebuffNotInstalledError('freebuff').code).toBe('FREEBUFF_NOT_INSTALLED')
    const failure = new FreebuffRunFailure('turn', 'limit', 'exceeded', 'SCREEN-TEXT', new Error('cause'))
    expect(failure.code).toBe('FREEBUFF_RUN_FAILED')
    expect(failure.message).toBe('subagent-freebuff: Product subagent failure (product: Freebuff; stage: turn; category: limit; detail: exceeded)')
    expect(failure.message).not.toContain('SCREEN-TEXT')
    expect(failure.screenTail).toBe('SCREEN-TEXT')
    expect(new FreebuffRunFailure('startup', 'blocked').message).not.toContain('detail')
  })
})

describe('startFreebuffRun abort handling', () => {
  it('terminates the terminal and rejects when the request is aborted while it spawns', async () => {
    const controller = new AbortController()
    let finish: (outcome: { exitCode: number; signal: null }) => void = () => {}
    const done = new Promise<{ exitCode: number; signal: null }>((resolve) => { finish = resolve })
    const terminate = vi.fn(async () => { finish({ exitCode: 0, signal: null }) })
    const terminal = { pid: 1, output: new PassThrough(), done, write: async () => {}, terminate }
    const spawnTerminal = async (): Promise<never> => {
      controller.abort()
      terminal.output.write('Freebuff / model to change | for history')
      return terminal as never
    }
    const request = { prompt: [{ type: 'text', text: 'task' }], signal: controller.signal } as never
    await expect(startFreebuffRun(request, {
      cwd: tmpdir(),
      executable: 'freebuff',
      args: [],
      env: {},
      trustAgents: false,
      startupTimeoutMs: 400,
      idleMs: 100,
      timeoutMs: 5_000,
      disposeGraceMs: 100,
      configDir: tmpdir(),
      platform: process.platform,
      comSpec: undefined,
      spawnTerminal,
    })).rejects.toThrow('aborted before run publication')
    expect(terminate).toHaveBeenCalledTimes(1)
  })
})

describe('Freebuff launch through a Windows batch shim', () => {
  const SHIM = 'C:\Program Files (x86)\Free buff\freebuff.cmd'

  function runSpec(args: readonly string[], spawnTerminal: (spec: SubprocessTerminalSpawnSpec) => Promise<never>): FreebuffRunSpec {
    return {
      cwd: tmpdir(),
      executable: SHIM,
      args,
      env: { KEEP: '1' },
      trustAgents: true,
      startupTimeoutMs: 400,
      idleMs: 100,
      timeoutMs: 5_000,
      disposeGraceMs: 100,
      configDir: tmpdir(),
      platform: 'win32',
      comSpec: 'C:\Windows\System32\cmd.exe',
      spawnTerminal,
    }
  }

  const request = { prompt: [{ type: 'text', text: 'task' }], signal: new AbortController().signal } as never

  it('wraps the shim and refuses shell metacharacters only for a shim', () => {
    expect(launchCommand(SHIM, ['--a'], 'win32', undefined)).toEqual({
      argv: ['cmd.exe', '/d', '/c', '%DSH_FREEBUFF_DOCTOR_EXE%', '--a'],
      env: { DSH_FREEBUFF_DOCTOR_EXE: `"${SHIM}"` },
    })
    expect(() => launchCommand(SHIM, ['a&b'], 'win32', undefined)).toThrow('cannot be given an argument')
    expect(launchCommand('/usr/bin/freebuff', ['a&b'], 'linux', undefined).argv).toEqual(['/usr/bin/freebuff', 'a&b'])
    expect(launchCommand('C:\bin\freebuff.exe', ['a&b'], 'win32', undefined).argv).toEqual(['C:\bin\freebuff.exe', 'a&b'])
  })

  it('starts the terminal through the command interpreter with the shim path in the environment', async () => {
    let seen: SubprocessTerminalSpawnSpec | undefined
    await expect(startFreebuffRun(request, runSpec(['--x'], async (spec) => {
      seen = spec
      throw new Error('stop here')
    }))).rejects.toThrow('could not be started')
    expect(seen?.argv).toEqual(['C:\Windows\System32\cmd.exe', '/d', '/c', '%DSH_FREEBUFF_DOCTOR_EXE%', '--x', '--trust-agents'])
    expect(seen?.env).toEqual({ KEEP: '1', DSH_FREEBUFF_DOCTOR_EXE: `"${SHIM}"` })
  })

  it('fails the startup without spawning when an argument cannot pass through the shell', async () => {
    const spawnTerminal = vi.fn(async (): Promise<never> => { throw new Error('unreachable') })
    await expect(startFreebuffRun(request, runSpec(['--x=%PATH%'], spawnTerminal))).rejects.toThrow('cannot be passed through the Windows shell')
    expect(spawnTerminal).not.toHaveBeenCalled()
  })
})

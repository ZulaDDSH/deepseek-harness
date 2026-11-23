import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { afterEach, describe, expect, it } from 'vitest'
import {
  FREEBUFF_LOGIN_COMMAND,
  FreebuffNotInstalledError,
  FreebuffNotLoggedInError,
  FreebuffRunFailure,
} from '../src/errors.ts'
import { checkFreebuffLogin, doctorArgv, freebuffLoginFailure } from '../src/login.ts'
import { taskText } from '../src/run.ts'
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
    expect(screenAnswer(screen, 'do the thing\nmore detail')).toBe('First answer line\nSecond answer line')
  })

  it('keeps the whole screen text when the task echo is not found', () => {
    expect(screenAnswer(['Only line', '/model to change  |  for history'].join('\n'), 'missing')).toBe('Only line')
  })

  it('does not anchor on an empty task', () => {
    expect(screenAnswer('answer', '')).toBe('answer')
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

describe('doctorArgv', () => {
  it('runs doctor directly except for Windows batch shims', () => {
    expect(doctorArgv('/usr/bin/freebuff', 'linux', undefined)).toEqual(['/usr/bin/freebuff', 'doctor', '--json'])
    expect(doctorArgv('C:\\bin\\freebuff.exe', 'win32', 'cmd.exe')).toEqual(['C:\\bin\\freebuff.exe', 'doctor', '--json'])
    expect(doctorArgv('C:\\bin\\freebuff.cmd', 'win32', 'C:\\Windows\\System32\\cmd.exe')).toEqual([
      'C:\\Windows\\System32\\cmd.exe', '/d', '/s', '/c', 'C:\\bin\\freebuff.cmd', 'doctor', '--json',
    ])
    expect(doctorArgv('C:\\bin\\freebuff.BAT', 'win32', undefined)[0]).toBe('cmd.exe')
  })
})

describe('checkFreebuffLogin', () => {
  function fakeSpawn(stdout: string | undefined, behaviour: 'exit' | 'reject' | 'throw' = 'exit') {
    const specs: SubprocessSpawnSpec[] = []
    const spawn = (spec: SubprocessSpawnSpec): SubprocessHandle => {
      specs.push(spec)
      if (behaviour === 'throw') throw new Error('spawn failed')
      return {
        done: behaviour === 'reject' ? Promise.reject(new Error('doctor failed')) : Promise.resolve({ exitCode: 1, signal: null }),
        collected: { stdout: stdout === undefined ? undefined : { readFrom: () => ({ text: stdout, nextOffset: stdout.length, lossy: false }) } },
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

  it('finds the newest chat transcript written since the run started', () => {
    const root = tempRoot()
    const old = chat(root, 'proj', 'old', [])
    const fresh = chat(root, 'proj', 'fresh', [])
    const newer = chat(root, 'proj', 'newer', [])
    utimesSync(old, new Date(1_000), new Date(1_000))
    utimesSync(fresh, new Date(5_000), new Date(5_000))
    utimesSync(newer, new Date(6_000), new Date(6_000))
    expect(findChatFile(root, join('/some', 'proj'), 4_000)).toBe(newer)
    expect(findChatFile(root, join('/some', 'proj'), 7_000)).toBeUndefined()
    expect(findChatFile(root, join('/some', 'other'), 0)).toBeUndefined()
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
    const failure = new FreebuffRunFailure('turn', 'limit', 'exceeded', 'tail', new Error('cause'))
    expect(failure.code).toBe('FREEBUFF_RUN_FAILED')
    expect(failure.message).toBe('subagent-freebuff: Product subagent failure (product: Freebuff; stage: turn; category: limit; detail: exceeded)')
    expect(failure.message).not.toContain('tail')
    expect(failure.screenTail).toBe('tail')
    expect(new FreebuffRunFailure('startup', 'blocked').message).not.toContain('detail')
  })
})

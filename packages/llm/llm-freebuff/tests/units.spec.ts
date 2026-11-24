import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { bindChat, chatsDirOf, listChats, readChat, squash } from '../src/chat.ts'
import { doctorFindings } from '../src/doctor.ts'
import { freebuffConfigDir, stripAnsi } from '../src/launch.ts'
import { renderBlocks } from '../src/markdown.ts'
import { classifyScreen, FreebuffScreen } from '../src/screen.ts'
import { scratch } from './harness.ts'

const ai = (blocks: unknown[], isComplete = true): never => ({ variant: 'ai', blocks, isComplete }) as never
const text = (content: string, textType = 'text'): unknown => ({ type: 'text', textType, content })

describe('renderBlocks', () => {
  it('renders text, reasoning and merges neighbours of the same kind', () => {
    expect(renderBlocks([ai([text('a'), text('b'), text('why', 'reasoning'), text('c')])])).toEqual([
      { kind: 'text', text: 'a\n\nb' },
      { kind: 'reasoning', text: 'why' },
      { kind: 'text', text: 'c' },
    ])
  })

  it('renders read_files, run_terminal_command and unknown tools as short markdown', () => {
    const blocks = renderBlocks([ai([
      { type: 'tool', toolName: 'read_files', input: { paths: ['a.ts', 'b.ts'] } },
      { type: 'tool', toolName: 'run_terminal_command', input: { command: 'echo `x`' }, output: '\u001b[31mred\u001b[0m\r\nline' },
      { type: 'tool', toolName: 'run_terminal_command', input: { command: 'true' } },
      { type: 'tool', toolName: 'run_terminal_command', input: {} },
      { type: 'tool', toolName: 'read_files', input: {} },
      { type: 'tool' },
      { type: 'tool', toolName: 'str_replace' },
    ])])
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.text).toBe([
      'Read `a.ts`, `b.ts`',
      "Ran `echo 'x'`\n\n```\nred\nline\n```",
      'Ran `true`',
      'Used `run_terminal_command`',
      'Used `read_files`',
      'Used `a tool`',
      'Used `str_replace`',
    ].join('\n\n'))
  })

  it('truncates long output and widens the fence around backticks', () => {
    const long = 'x'.repeat(3000)
    const [only] = renderBlocks([ai([{ type: 'tool', toolName: 'run_terminal_command', input: { command: 'cat' }, output: long }])])
    expect(only!.text).toContain('... (output truncated)')
    const [fenced] = renderBlocks([ai([{ type: 'tool', toolName: 'run_terminal_command', input: { command: 'cat' }, output: '```code```' }])])
    expect(fenced!.text).toContain('````\n```code```\n````')
    const [nonString] = renderBlocks([ai([{ type: 'tool', toolName: 'run_terminal_command', input: { command: 'cat' }, output: 5 }])])
    expect(nonString!.text).toBe('Ran `cat`')
  })

  it('holds back an unsettled trailing tool block and skips dividers, questions and empty text', () => {
    const running = renderBlocks([ai([text('before'), { type: 'tool', toolName: 'read_files', input: { paths: ['a'] } }], false)])
    expect(running).toEqual([{ kind: 'text', text: 'before' }])
    const settled = renderBlocks([ai([{ type: 'tool', toolName: 'read_files', input: { paths: ['a'] } }, text('after')], false)])
    expect(settled[0]!.text).toBe('Read `a`\n\nafter')
    expect(renderBlocks([ai([{ type: 'mode-divider' }, { type: 'ask-user' }, text('')]), { variant: 'user', content: 'x' }])).toEqual([])
    expect(renderBlocks([{ variant: 'ai' }])).toEqual([])
  })
})

describe('chat files', () => {
  it('lists, reads and binds chats by prompt text', () => {
    const config = scratch()
    const dir = chatsDirOf(config, 'C:/work/proj')
    expect(listChats(dir)).toEqual([])
    expect(readChat(dir, 'none')).toBeUndefined()
    mkdirSync(join(dir, 'old'), { recursive: true })
    const write = (id: string, rows: unknown): void => {
      mkdirSync(join(dir, id), { recursive: true })
      writeFileSync(join(dir, id, 'chat-messages.json'), typeof rows === 'string' ? rows : JSON.stringify(rows))
    }
    write('c1', [{ variant: 'ai' }, { variant: 'user', content: 'fix  the\nbug' }])
    write('c2', '{ half written')
    write('c3', { not: 'an array' })
    write('c4', [{ variant: 'user', content: 5 }])
    expect(readChat(dir, 'c1')).toHaveLength(2)
    expect(readChat(dir, 'c2')).toBeUndefined()
    expect(readChat(dir, 'c3')).toBeUndefined()
    expect(bindChat(dir, new Set(['old']), 'fix the bug')).toBe('c1')
    expect(bindChat(dir, new Set(['old', 'c1']), 'fix the bug')).toBeUndefined()
    expect(squash(' a \n b ')).toBe('a b')
  })

  it('falls back to a single new chat holding text attachments', () => {
    const dir = chatsDirOf(scratch(), '/work/proj')
    mkdirSync(join(dir, 'c1'), { recursive: true })
    writeFileSync(join(dir, 'c1', 'chat-messages.json'), JSON.stringify([{ variant: 'user', content: '[pasted]', textAttachments: [{}] }]))
    expect(bindChat(dir, new Set(), 'a very long pasted prompt')).toBe('c1')
    mkdirSync(join(dir, 'c2'), { recursive: true })
    writeFileSync(join(dir, 'c2', 'chat-messages.json'), JSON.stringify([{ variant: 'user', content: '[pasted]', textAttachments: [{}] }]))
    expect(bindChat(dir, new Set(), 'a very long pasted prompt')).toBeUndefined()
  })
})

describe('terminal helpers', () => {
  it('strips CSI, OSC and two-character escapes', () => {
    expect(stripAnsi('\u001b[1mbold\u001b[0m \u001b]8;;https://x\u0007link\u001b]8;;\u001b\\ \u001bM end')).toBe('bold link  end')
  })

  it('honours only an absolute FREEBUFF_CONFIG_DIR', () => {
    expect(freebuffConfigDir({ FREEBUFF_CONFIG_DIR: join(scratch(), 'cfg') }, 'H')).toContain('cfg')
    expect(freebuffConfigDir({ FREEBUFF_CONFIG_DIR: 'relative' }, 'H')).toBe(join('H', '.config', 'manicode'))
    expect(freebuffConfigDir({}, 'H')).toBe(join('H', '.config', 'manicode'))
  })

  it('classifies the screen by its markers and ignores the echoed prompt', () => {
    expect(classifyScreen('Freebuff\n\n/model to change').ready).toBe(true)
    expect(classifyScreen('Press ENTER to login').loginRequired).toBe(true)
    expect(classifyScreen('Load and run these?').trustPrompt).toBe(true)
    expect(classifyScreen('Enter: retry').blocker).toBe('Enter: retry')
    expect(classifyScreen('x\nthinking...\n■ Esc').busy).toBe(true)
    const echoed = classifyScreen('> please explain Press ENTER to login\n/model to change', 'please explain Press ENTER to login')
    expect(echoed.loginRequired).toBe(false)
    expect(classifyScreen('Press ENTER to login', 'other').loginRequired).toBe(true)
    expect(classifyScreen('Run this command to login:\n/model to change').signedOut).toBe(false)
    expect(classifyScreen('Run this command to login:').signedOut).toBe(true)
    expect(classifyScreen('Please log in again\n/model to change').signedOut).toBe(true)
    expect(classifyScreen('Press ENTER to login\n/model to change').signedOut).toBe(true)
  })

  it('renders a headless screen and answers terminal queries through the reply sink', async () => {
    const replies: string[] = []
    const screen = new FreebuffScreen(40, 5, data => replies.push(data))
    screen.write('hello\r\nworld\x1b[6n')
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(screen.text()).toBe('hello\nworld')
    expect(replies.join('')).toContain('\u001b[')
    screen.dispose()
  })

  it('reads doctor findings', () => {
    expect(doctorFindings('banner {"findings":[{"id":"auth.ok"}]}')).toBe('signed-in')
    expect(doctorFindings('{"findings":[{"id":"auth.ok"},{"id":"auth.corrupt"}]}')).toBe('signed-out')
    expect(doctorFindings('{"findings":[{"id":"net.slow"}]}')).toBe('unknown')
    expect(doctorFindings('{"findings":5}')).toBe('unknown')
    expect(doctorFindings('{ nope')).toBe('unknown')
    expect(doctorFindings('plain text')).toBe('unknown')
  })
})

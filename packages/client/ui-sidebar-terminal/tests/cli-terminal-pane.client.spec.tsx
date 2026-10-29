// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ThemeSnapshot } from '@deepseek-ai/dsh-client-ui-theme/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { TerminalView, TerminalViewState } from '@deepseek-ai/dsh-api-terminal-controller/client'
import type { WebTerminalId } from '@deepseek-ai/dsh-api-terminal-controller/types'
import { CliTerminalPane, type CliTerminalPaneProps } from '../src/client/CliTerminalPane.tsx'
import { en } from '../src/client/locales.ts'

const fake = vi.hoisted(() => ({ terminals: [] as FakeTerminal[] }))

class FakeTerminal {
  options: object
  textarea: HTMLTextAreaElement | undefined = document.createElement('textarea')
  input: ((data: string) => void) | undefined
  constructor(options: object) { this.options = options; fake.terminals.push(this) }
  open(node: HTMLElement) { node.appendChild(this.textarea!) }
  onData(input: (data: string) => void) { this.input = input; return { dispose: vi.fn() } }
  readonly parser = { registerOscHandler: vi.fn(() => ({ dispose: vi.fn() })) }
  onRender() { return { dispose: vi.fn() } }
  readonly write = vi.fn((_data: string, callback: () => void) => { callback() })
  readonly resize = vi.fn()
  readonly reset = vi.fn()
  readonly focus = vi.fn()
  readonly dispose = vi.fn()
  readonly loadAddon = vi.fn()
}

vi.mock('@xterm/xterm', () => ({ Terminal: vi.fn(function (options: object) { return new FakeTerminal(options) }) }))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { proposeDimensions() { return { cols: 100, rows: 30 } } } }))

beforeEach(() => {
  fake.terminals.length = 0
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const environment = { cwd: '/workspace', maxCols: 200, maxRows: 100, scrollback: 1000, maxInputBytes: 1000 }
const cliInfo = { id: 'cli' as WebTerminalId, title: 'grok', shell: { path: '/bin/bash', name: 'bash', args: ['-i'] }, cwd: '/workspace', cols: 80, rows: 24, state: 'running' as const, exitCode: null }

function store(initial: TerminalViewState) {
  let current = initial
  const listeners = new Set<() => void>()
  return {
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    getSnapshot: () => current,
    update: vi.fn(),
    set(next: TerminalViewState) { current = next; for (const listener of listeners) listener() },
  }
}

function mount(initial: TerminalViewState) {
  const close = vi.fn()
  const state = store(initial)
  const model = {
    mount: vi.fn(() => () => {}), refresh: vi.fn(async () => {}), connect: vi.fn(), write: vi.fn(), resize: vi.fn(),
    acknowledge: vi.fn(), state,
  }
  const theme: ThemeSnapshot = { preference: 'light', fontSize: 14, fontFamily: 'default', fontStack: undefined, active: { id: 'light', colorScheme: 'light', tokens: {} }, themes: [], revision: 0 }
  const view: Partial<TerminalView> = model
  const props: CliTerminalPaneProps = {
    profile: 'grok-cli',
    cli: vi.fn(() => view as TerminalView), close,
    useTheme: <S,>(select: (value: ThemeSnapshot) => S) => select(theme),
    t: makeTranslate(en),
  }
  render(<CliTerminalPane {...props} />)
  return { model, state, close }
}

it('names the CLI in a header whose Close button closes that profile', () => {
  const { close } = mount({ phase: 'connected', writable: true, environment, info: { ...cliInfo, cli: { profile: 'grok-cli', command: 'grok', installed: true, installUrl: 'https://x.ai/cli' } } })
  expect(screen.getByText('Grok CLI')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  expect(close).toHaveBeenCalledOnce()
  expect(close).toHaveBeenCalledWith('grok-cli')
})

it('shows the install hint outside the terminal screen while the command is missing', () => {
  mount({ phase: 'connected', writable: true, environment, info: { ...cliInfo, cli: { profile: 'grok-cli', command: 'grok', installed: false, installUrl: 'https://x.ai/cli' } } })
  expect(screen.getByRole('note').textContent).toContain('`grok`')
  expect(screen.getByRole('link', { name: 'Install instructions' }).getAttribute('href')).toBe('https://x.ai/cli')
  expect(document.querySelector('[data-cli-terminal]')?.contains(screen.getByRole('note'))).toBe(true)
  expect(fake.terminals).toHaveLength(1)
})

it('shows no install hint when the command is on PATH', () => {
  mount({ phase: 'connected', writable: true, environment, info: { ...cliInfo, cli: { profile: 'grok-cli', command: 'grok', installed: true, installUrl: 'https://x.ai/cli' } } })
  expect(screen.queryByRole('note')).toBeNull()
})

it('reports an exited CLI with its exit code and keeps the screen', () => {
  mount({ phase: 'connected', writable: true, environment, info: { ...cliInfo, state: 'exited', exitCode: 0 } })
  expect(screen.getByRole('status').textContent).toContain('0')
  expect(fake.terminals).toHaveLength(1)
})

it('writes to the PTY only from the terminal input handler', () => {
  const { model } = mount({ phase: 'connected', writable: true, environment, info: { ...cliInfo, cli: { profile: 'grok-cli', command: 'grok', installed: true, installUrl: 'https://x.ai/cli' } } })
  expect(model.write).not.toHaveBeenCalled()
  fake.terminals[0]!.input?.('ls\r')
  expect(model.write).toHaveBeenCalledOnce()
  expect(model.write).toHaveBeenCalledWith('ls\r')
})

it('confines PTY writes in the CLI pane and terminal screen to the input handler', () => {
  const clientDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'client')
  const pane = readFileSync(join(clientDir, 'CliTerminalPane.tsx'), 'utf8')
  const terminalSource = readFileSync(join(clientDir, 'terminal.tsx'), 'utf8')
  expect(pane).not.toMatch(/model\.write\(|\.resize\(/u)
  const writes = terminalSource.split('\n').filter(line => /model\.write\(/u.test(line))
  expect(writes).toHaveLength(1)
  expect(writes[0]).toContain('xterm.onData')
})

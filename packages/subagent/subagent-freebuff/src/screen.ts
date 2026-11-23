import type { Terminal as HeadlessTerminal } from '@xterm/headless'
import { createLazyRequire } from '@deepseek-ai/dsh-lazy-require'

const requireHeadless = createLazyRequire<typeof import('@xterm/headless')>('@xterm/headless', import.meta.url)

const LOGIN_MARKERS = ['Press ENTER to login', 'to login:', 'Waiting for login', 'Please log in again'] as const
const TRUST_MARKER = 'Load and run these?'
const BLOCKER_MARKERS = [
  'Enter: confirm and send',
  'Enter: take over',
  'Enter: choose another model',
  'Enter: retry',
] as const
const BUSY_MARKERS = ['thinking...', 'working...', '■ Esc'] as const
const READY_MARKERS = ['/model to change', 'for history'] as const
const CHROME_PATTERN = /thinking\.\.\.|working\.\.\.|■ Esc|✕ End session|\/model to change|for history/
const STATUS_ROWS = 8
const ANSWER_ANCHOR_CHARS = 30

export interface ScreenState {
  readonly loginRequired: boolean
  readonly trustPrompt: boolean
  readonly blocker: string | undefined
  readonly busy: boolean
  readonly ready: boolean
}

function includesAny(text: string, markers: readonly string[]): boolean {
  return markers.some(marker => text.includes(marker))
}

export function classifyScreen(text: string): ScreenState {
  const bottom = text.split('\n').filter(line => line.trim().length > 0).slice(-STATUS_ROWS).join('\n')
  return {
    loginRequired: includesAny(text, LOGIN_MARKERS),
    trustPrompt: text.includes(TRUST_MARKER),
    blocker: BLOCKER_MARKERS.find(marker => text.includes(marker)),
    busy: includesAny(bottom, BUSY_MARKERS),
    ready: includesAny(bottom, READY_MARKERS),
  }
}

export function screenAnswer(text: string, task: string): string {
  const lines = text.split('\n')
  const anchor = (task.split('\n').find(line => line.trim().length > 0) ?? '').trim().slice(0, ANSWER_ANCHOR_CHARS)
  const anchored = anchor.length === 0 ? -1 : lines.findLastIndex(line => line.includes(anchor))
  return lines
    .slice(anchored + 1)
    .filter(line => !CHROME_PATTERN.test(line))
    .join('\n')
    .trim()
}

export class FreebuffScreen {
  private readonly emulator: HeadlessTerminal
  private readonly replies: { dispose(): void }

  constructor(cols: number, rows: number, reply: (data: string) => void) {
    const { Terminal } = requireHeadless()
    this.emulator = new Terminal({ cols, rows, scrollback: 0 })
    this.replies = this.emulator.onData(reply)
  }

  write(data: string): void {
    this.emulator.write(data)
  }

  text(): string {
    const buffer = this.emulator.buffer.active
    const lines: string[] = []
    for (let row = 0; row < buffer.length; row += 1) {
      lines.push(buffer.getLine(row)?.translateToString(true) ?? '')
    }
    while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
    return lines.join('\n')
  }

  dispose(): void {
    this.replies.dispose()
    this.emulator.dispose()
  }
}

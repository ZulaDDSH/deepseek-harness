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
const READY_MARKERS = ['/model to change', 'for history'] as const
const FOOTER_MARKER = '/model to change'
const BUSY_LINE = /^\s*(?:\S\s+)?(?:thinking|working)\.\.\.(?:\s+[\dsmh ]+)?\s*$|■ Esc\s*$/
const STATUS_LINE = /✕ End session\s*$|■ Esc\s*$/
const CHROME_PATTERN = /^\s*(?:\S\s+)?(?:thinking|working)\.\.\.|■ Esc|✕ End session|\/model to change|for history|^\s*⎘ •/
const FOOTER_ROWS = 8
const STATUS_ROWS = 16
const ANSWER_ANCHOR_CHARS = 30

export const CLIPPED_NOTICE = "[Freebuff's chat transcript was not found and its task echo is not visible on the screen, so this answer may be incomplete.]"

export interface ScreenState {
  readonly loginRequired: boolean
  readonly trustPrompt: boolean
  readonly blocker: string | undefined
  readonly busy: boolean
  readonly ready: boolean
}

export interface ScreenAnswer {
  readonly text: string
  readonly clipped: boolean
}

function squash(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

export function classifyScreen(text: string, task?: string): ScreenState {
  const rows = text.split('\n').filter(line => line.trim().length > 0)
  const bottom = rows.slice(-FOOTER_ROWS).join('\n')
  const status = rows.slice(-STATUS_ROWS)
  const scope = task === undefined ? text : status.join('\n')
  const quoted = task === undefined ? '' : squash(task)
  const found = (marker: string): boolean => scope.includes(marker) && !quoted.includes(marker)
  return {
    loginRequired: LOGIN_MARKERS.some(found),
    trustPrompt: text.includes(TRUST_MARKER),
    blocker: BLOCKER_MARKERS.find(found),
    busy: status.some(line => BUSY_LINE.test(line)),
    ready: READY_MARKERS.some(marker => bottom.includes(marker)),
  }
}

function dropTrailingBoxes(lines: string[]): string[] {
  let end = lines.length
  for (;;) {
    while (end > 0 && (lines[end - 1] ?? '').trim().length === 0) end -= 1
    if (end === 0 || !(lines[end - 1] ?? '').trimStart().startsWith('╰')) return lines.slice(0, end)
    const top = lines.slice(0, end).findLastIndex(line => line.trimStart().startsWith('╭'))
    if (top < 0) return lines.slice(0, end)
    end = top
  }
}

export function screenAnswer(text: string, task: string): ScreenAnswer {
  let lines = text.split('\n')
  const ends = [
    lines.findLastIndex(line => line.includes(FOOTER_MARKER)),
    lines.findLastIndex(line => STATUS_LINE.test(line)),
  ].filter(index => index >= 0)
  if (ends.length > 0) lines = lines.slice(0, Math.min(...ends))
  lines = dropTrailingBoxes(lines)
  const anchor = (task.split('\n').find(line => line.trim().length > 0) ?? '').trim().slice(0, ANSWER_ANCHOR_CHARS)
  const anchored = anchor.length === 0 ? -1 : lines.findLastIndex(line => line.includes(anchor))
  return {
    text: lines
      .slice(anchored + 1)
      .filter(line => !CHROME_PATTERN.test(line))
      .join('\n')
      .trim(),
    clipped: anchor.length > 0 && anchored < 0,
  }
}

export class FreebuffScreen {
  private readonly emulator: HeadlessTerminal
  private readonly replies: { dispose(): void }

  constructor(cols: number, rows: number, reply: (data: string) => void) {
    const { Terminal } = requireHeadless()
    this.emulator = new Terminal({ cols, rows, scrollback: 0, allowProposedApi: true })
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

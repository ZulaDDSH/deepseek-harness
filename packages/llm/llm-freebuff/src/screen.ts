import type { Terminal as HeadlessTerminal } from '@xterm/headless'
import { createLazyRequire } from '@deepseek-ai/dsh-lazy-require'

const requireHeadless = createLazyRequire<typeof import('@xterm/headless')>('@xterm/headless', import.meta.url)

const LOGIN_MARKERS = ['Press ENTER to login', 'to login:', 'Waiting for login', 'Please log in again'] as const
const WEAK_LOGIN_MARKER = 'to login:'
const TRUST_MARKER = 'Load and run these?'
const BLOCKER_MARKERS = [
  'Enter: confirm and send',
  'Enter: take over',
  'Enter: choose another model',
  'Enter: retry',
] as const
const READY_MARKERS = ['/model to change', 'for history'] as const
const BUSY_LINE = /^\s*(?:\S\s+)?(?:thinking|working)\.\.\.(?:\s+[\dsmh ]+)?\s*$|■ Esc\s*$/
const FOOTER_ROWS = 8
const STATUS_ROWS = 16

export interface ScreenState {
  readonly loginRequired: boolean
  readonly signedOut: boolean
  readonly trustPrompt: boolean
  readonly blocker: string | undefined
  readonly busy: boolean
  readonly ready: boolean
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
  const ready = READY_MARKERS.some(marker => bottom.includes(marker))
  return {
    loginRequired: LOGIN_MARKERS.some(found),
    signedOut: LOGIN_MARKERS.some(marker => found(marker) && (marker !== WEAK_LOGIN_MARKER || !ready)),
    trustPrompt: text.includes(TRUST_MARKER),
    blocker: BLOCKER_MARKERS.find(found),
    busy: status.some(line => BUSY_LINE.test(line)),
    ready,
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
      lines.push(String(buffer.getLine(row)?.translateToString(true)))
    }
    while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
    return lines.join('\n')
  }

  dispose(): void {
    this.replies.dispose()
    this.emulator.dispose()
  }
}

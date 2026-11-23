import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { PassThrough } from 'node:stream'
import type { SubprocessOutcome, SubprocessTerminalHandle, SubprocessTerminalSpawnSpec } from '@deepseek-ai/dsh-subprocess'

const PASTE = /\u001b\[200~([\s\S]*)\u001b\[201~/
const READY = ['Freebuff', '', '/model to change  |  for history']
const BUSY = ['Freebuff', '', 'thinking...', '■ Esc']

export interface FakeScript {
  reply?: (prompt: string, turn: number) => string
  refusal?: string
  login?: boolean
  hold?: boolean
  ignoreEscape?: boolean
  exitOnSubmit?: boolean
  replyDelayMs?: number
}

interface Row {
  id: string
  variant: string
  content?: string
  blocks?: unknown[]
  isComplete?: boolean
  userError?: string
}

export class FakeFreebuff {
  readonly spawns: SubprocessTerminalSpawnSpec[] = []
  readonly terminals: FakeTerminal[] = []
  readonly prompts: string[] = []
  escapes = 0
  killed = 0
  script: FakeScript = {}
  private counter = 0

  constructor(readonly configDir: string) {}

  nextId(prefix: string): string {
    this.counter += 1
    return `${prefix}${String(this.counter).padStart(4, '0')}`
  }

  readonly spawnTerminal = (spec: SubprocessTerminalSpawnSpec): Promise<SubprocessTerminalHandle> => {
    this.spawns.push(spec)
    const terminal = new FakeTerminal(this, spec)
    this.terminals.push(terminal)
    return Promise.resolve(terminal as unknown as SubprocessTerminalHandle)
  }

  chatsDir(cwd: string): string {
    return join(this.configDir, 'projects', basename(cwd), 'chats')
  }
}

export class FakeTerminal {
  readonly output = new PassThrough()
  readonly pid = 1
  readonly done: Promise<SubprocessOutcome>
  private finish!: (outcome: SubprocessOutcome) => void
  private chatId: string | undefined
  private pending: string | undefined
  private turns = 0
  private timer: NodeJS.Timeout | undefined
  private busy = false

  constructor(private readonly host: FakeFreebuff, private readonly spec: SubprocessTerminalSpawnSpec) {
    this.done = new Promise((resolve) => { this.finish = resolve })
    const at = spec.argv.indexOf('--continue')
    if (at >= 0) this.chatId = spec.argv[at + 1]
    this.show(host.script.login === true ? ['Freebuff', 'Press ENTER to login'] : READY)
  }

  private show(lines: string[]): void {
    this.output.write(`\u001b[2J\u001b[H${lines.join('\r\n')}`)
  }

  private file(): string {
    return join(this.host.chatsDir(this.spec.cwd), this.chatId ?? '', 'chat-messages.json')
  }

  private rows(): Row[] {
    try {
      return JSON.parse(readFileSync(this.file(), 'utf8')) as Row[]
    } catch {
      return []
    }
  }

  private save(rows: Row[]): void {
    writeFileSync(this.file(), JSON.stringify(rows))
  }

  write(data: string): Promise<void> {
    if (data === '\u001b') {
      this.host.escapes += 1
      if (this.host.script.ignoreEscape !== true) {
        clearTimeout(this.timer)
        this.busy = false
        this.show(READY)
      }
    } else if (data === '\r') {
      if (this.pending !== undefined) this.submit(this.pending)
      this.pending = undefined
    } else {
      const text = PASTE.exec(data)?.[1]
      if (text !== undefined) this.pending = text
    }
    return Promise.resolve()
  }

  private submit(prompt: string): void {
    const { script } = this.host
    this.host.prompts.push(prompt)
    if (this.chatId === undefined) {
      this.chatId = `2026-11-23T10-00-${this.host.nextId('')}`
      mkdirSync(join(this.host.chatsDir(this.spec.cwd), this.chatId), { recursive: true })
      this.save([{ id: this.host.nextId('d'), variant: 'ai', blocks: [{ type: 'mode-divider' }], isComplete: true }])
    }
    this.save([...this.rows(), { id: this.host.nextId('u'), variant: 'user', content: prompt }])
    this.turns += 1
    if (script.exitOnSubmit === true) {
      void this.terminate()
      return
    }
    if (script.refusal !== undefined) {
      this.save([...this.rows(), { id: this.host.nextId('a'), variant: 'ai', blocks: [], isComplete: true, userError: script.refusal }])
      this.show(READY)
      return
    }
    this.busy = true
    this.show(BUSY)
    if (script.hold === true) return
    const turn = this.turns
    this.timer = setTimeout(() => {
      const content = script.reply?.(prompt, turn) ?? `echo: ${prompt}`
      this.save([...this.rows(), { id: this.host.nextId('a'), variant: 'ai', blocks: [{ type: 'text', textType: 'text', content }], isComplete: true }])
      this.busy = false
      this.show(READY)
    }, script.replyDelayMs ?? 20)
  }

  get working(): boolean {
    return this.busy
  }

  resize(): Promise<void> {
    return Promise.resolve()
  }

  terminate(): Promise<void> {
    clearTimeout(this.timer)
    this.host.killed += 1
    this.finish({ exitCode: null, signal: 'SIGTERM' })
    return Promise.resolve()
  }
}

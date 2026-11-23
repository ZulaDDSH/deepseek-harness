import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { PassThrough } from 'node:stream'
import type { SubprocessOutcome, SubprocessTerminalActivity, SubprocessTerminalForeground, SubprocessTerminalHandle, SubprocessTerminalSpawnSpec } from '@deepseek-ai/dsh-subprocess'

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
  trust?: boolean
  blocker?: string
  stuck?: boolean
  exitOnSpawn?: boolean
  errorRow?: string
  askUser?: boolean
  silent?: boolean
  reasoning?: string
  stages?: { reasoning?: string; content?: string }[]
  failStop?: boolean
  failEscape?: boolean
  query?: boolean
  failReplies?: boolean
  trustDelayMs?: number
  midLogin?: boolean
  midBlocker?: string
  incomplete?: boolean
  recovers?: boolean
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
  trustAnswers = 0
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
    return Promise.resolve(terminal)
  }

  chatsDir(cwd: string): string {
    return join(this.configDir, 'projects', basename(cwd), 'chats')
  }
}

export class FakeTerminal implements SubprocessTerminalHandle {
  readonly output = new PassThrough()
  readonly pid = 1
  readonly done: Promise<SubprocessOutcome>
  private finish!: (outcome: SubprocessOutcome) => void
  private fail!: (error: Error) => void
  private chatId: string | undefined
  private pending: string | undefined
  private turns = 0
  private timer: NodeJS.Timeout | undefined
  private busy = false

  constructor(private readonly host: FakeFreebuff, private readonly spec: SubprocessTerminalSpawnSpec) {
    this.done = new Promise((resolve, reject) => {
      this.finish = resolve
      this.fail = reject
    })
    const at = spec.argv.indexOf('--continue')
    if (at >= 0) this.chatId = spec.argv[at + 1]
    const { script } = host
    if (script.exitOnSpawn === true) void this.terminate()
    if (script.trust === true) this.show(['Freebuff', 'Load and run these?'])
    else if (script.blocker !== undefined) this.show(['Freebuff', script.blocker])
    else if (script.stuck === true) this.show(['Freebuff'])
    else this.show(script.login === true ? ['Freebuff', 'Press ENTER to login'] : READY)
    if (script.query === true) this.output.write('\u001b[5n')
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
      if (this.host.script.failEscape === true) return Promise.reject(new Error('write failed'))
      if (this.host.script.ignoreEscape !== true) {
        clearTimeout(this.timer)
        this.busy = false
        this.show(READY)
      }
    } else if (data === 'n\r') {
      this.host.trustAnswers += 1
      if (this.host.script.trustDelayMs === undefined) this.show(READY)
      else setTimeout(() => { this.show(READY) }, this.host.script.trustDelayMs)
    } else if (data === '\r') {
      if (this.pending !== undefined) this.submit(this.pending)
      this.pending = undefined
    } else {
      const text = PASTE.exec(data)?.[1]
      if (text !== undefined) this.pending = text
      else if (this.host.script.failReplies === true) return Promise.reject(new Error('write failed'))
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
    if (script.silent === true) return
    this.save([...this.rows(), { id: this.host.nextId('u'), variant: 'user', content: prompt }])
    this.turns += 1
    if (script.exitOnSubmit === true) {
      void this.terminate()
      return
    }
    if (script.errorRow !== undefined || script.askUser === true) {
      const row = (script.askUser === true ? { id: this.host.nextId('a'), variant: 'ai', blocks: [{ type: 'ask-user' }], isComplete: false } : { id: this.host.nextId('e'), variant: 'error', content: script.errorRow }) as Row
      this.save([...this.rows(), row])
      if (script.recovers !== true) return
    }
    if (script.refusal !== undefined) {
      this.save([...this.rows(), { id: this.host.nextId('a'), variant: 'ai', blocks: [], isComplete: true, userError: script.refusal }])
      this.show(READY)
      return
    }
    if (script.midLogin === true || script.midBlocker !== undefined) {
      this.show(script.midLogin === true ? ['Freebuff', 'Press ENTER to login'] : ['Freebuff', script.midBlocker as string])
      return
    }
    this.busy = true
    this.show(BUSY)
    if (script.hold === true) return
    const turn = this.turns
    const stages = script.stages ?? [{ reasoning: script.reasoning, content: script.reply?.(prompt, turn) ?? `echo: ${prompt}` }]
    const id = this.host.nextId('a')
    const step = (index: number): void => {
      this.timer = setTimeout(() => {
        const stage = stages[index]!
        const last = index === stages.length - 1
        const blocks: unknown[] = stage.reasoning === undefined ? [] : [{ type: 'text', textType: 'reasoning', content: stage.reasoning }]
        if (stage.content !== undefined) blocks.push({ type: 'text', textType: 'text', content: stage.content })
        this.save([...this.rows().filter(row => row.id !== id), { id, variant: 'ai', blocks, isComplete: last && script.incomplete !== true }])
        if (last) {
          this.busy = false
          this.show(READY)
        } else step(index + 1)
      }, script.replyDelayMs ?? 20)
    }
    step(0)
  }

  get working(): boolean {
    return this.busy
  }

  resize(): Promise<void> {
    return Promise.resolve()
  }

  inspectForeground(): Promise<SubprocessTerminalForeground | undefined> {
    return Promise.resolve(undefined)
  }

  inspectActivity(): Promise<SubprocessTerminalActivity> {
    return Promise.resolve({ state: 'unknown', revision: 0 })
  }

  signalForeground(): Promise<number> {
    return Promise.resolve(this.pid)
  }

  terminate(): Promise<void> {
    clearTimeout(this.timer)
    this.host.killed += 1
    if (this.host.script.failStop === true) {
      this.fail(new Error('stop failed'))
      return Promise.reject(new Error('stop failed'))
    }
    this.finish({ exitCode: null, signal: 'SIGTERM' })
    return Promise.resolve()
  }
}

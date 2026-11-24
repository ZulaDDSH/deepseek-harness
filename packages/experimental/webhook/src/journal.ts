import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { VerifiedWebhookDelivery } from './types.ts'

export const MAX_JOURNAL_ENTRIES = 64
export const MAX_REPLAY_ATTEMPTS = 3
const COMPACT_AFTER_RECORDS = 512
const MAX_ERROR_CHARS = 500

export interface JournalRuleState {
  attempts: number
  state: 'pending' | 'failed'
  error?: string
}

export interface JournalEntry {
  readonly id: string
  readonly delivery: VerifiedWebhookDelivery
  readonly rules: Map<string, JournalRuleState>
}

type JournalRecord =
  | { readonly op: 'add'; readonly id: string; readonly delivery: VerifiedWebhookDelivery; readonly rules: string[] }
  | { readonly op: 'attempt'; readonly id: string; readonly rule: string }
  | { readonly op: 'done'; readonly id: string; readonly rule: string }
  | { readonly op: 'fail'; readonly id: string; readonly rule: string; readonly error: string }
  | { readonly op: 'drop'; readonly id: string }

function isRecord(value: unknown): value is JournalRecord {
  if (value === null || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  if (typeof record['id'] !== 'string') return false
  switch (record['op']) {
    case 'add': return typeof record['delivery'] === 'object' && Array.isArray(record['rules'])
    case 'drop': return true
    case 'attempt': case 'done': return typeof record['rule'] === 'string'
    case 'fail': return typeof record['rule'] === 'string' && typeof record['error'] === 'string'
    default: return false
  }
}

function writeDurably(path: string, flags: 'a' | 'w', text: string): void {
  mkdirSync(dirname(path), { recursive: true })
  const fd = openSync(path, flags, 0o600)
  try {
    writeSync(fd, text)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

export class WebhookJournal {
  private readonly entries = new Map<string, JournalEntry>()
  private appended = 0

  constructor(private readonly file: string) {
    let text = ''
    try {
      text = readFileSync(file, 'utf8')
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const lines = text.split('\n').filter(line => line !== '')
    lines.forEach((line, index) => {
      let record: unknown
      try {
        record = JSON.parse(line)
      } catch {
        if (index === lines.length - 1) return
        throw new Error(`webhook journal ${file} is corrupt at line ${String(index + 1)}`)
      }
      if (!isRecord(record)) throw new Error(`webhook journal ${file} has an unknown record at line ${String(index + 1)}`)
      this.apply(record)
    })
    this.compact()
  }

  add(delivery: VerifiedWebhookDelivery, rules: readonly string[]): string {
    if (this.entries.size >= MAX_JOURNAL_ENTRIES) {
      const settled = [...this.entries.values()].find(entry => ![...entry.rules.values()].some(rule => rule.state === 'pending'))
      if (settled === undefined) throw new Error('webhook journal is full of unfinished deliveries')
      this.write({ op: 'drop', id: settled.id })
    }
    const id = randomUUID()
    this.write({ op: 'add', id, delivery, rules: [...rules] })
    return id
  }

  pendingFor(rule: string): JournalEntry[] {
    return [...this.entries.values()].filter(entry => entry.rules.get(rule)?.state === 'pending')
  }

  attempt(id: string, rule: string): number {
    this.write({ op: 'attempt', id, rule })
    return this.entries.get(id)?.rules.get(rule)?.attempts ?? 0
  }

  done(id: string, rule: string): void {
    this.write({ op: 'done', id, rule })
  }

  fail(id: string, rule: string, error: string): void {
    this.write({ op: 'fail', id, rule, error: error.slice(0, MAX_ERROR_CHARS) })
  }

  private write(record: JournalRecord): void {
    writeDurably(this.file, 'a', `${JSON.stringify(record)}\n`)
    this.apply(record)
    if (++this.appended > COMPACT_AFTER_RECORDS) this.compact()
  }

  private apply(record: JournalRecord): void {
    if (record.op === 'add') {
      this.entries.set(record.id, {
        id: record.id,
        delivery: record.delivery,
        rules: new Map(record.rules.map(rule => [rule, { attempts: 0, state: 'pending' }])),
      })
      return
    }
    const entry = this.entries.get(record.id)
    if (entry === undefined) return
    if (record.op === 'drop') {
      this.entries.delete(record.id)
      return
    }
    const rule = entry.rules.get(record.rule)
    if (rule === undefined) return
    if (record.op === 'attempt') rule.attempts++
    else if (record.op === 'fail') Object.assign(rule, { state: 'failed', error: record.error })
    else entry.rules.delete(record.rule)
    if (entry.rules.size === 0) this.entries.delete(record.id)
  }

  private compact(): void {
    const lines: string[] = []
    for (const entry of this.entries.values()) {
      lines.push(JSON.stringify({ op: 'add', id: entry.id, delivery: entry.delivery, rules: [...entry.rules.keys()] }))
      for (const [rule, state] of entry.rules) {
        for (let attempt = 0; attempt < state.attempts; attempt++) lines.push(JSON.stringify({ op: 'attempt', id: entry.id, rule }))
        if (state.state === 'failed') lines.push(JSON.stringify({ op: 'fail', id: entry.id, rule, error: state.error ?? '' }))
      }
    }
    const temp = `${this.file}.${randomUUID()}.tmp`
    writeDurably(temp, 'w', lines.map(line => `${line}\n`).join(''))
    renameSync(temp, this.file)
    this.appended = 0
  }
}

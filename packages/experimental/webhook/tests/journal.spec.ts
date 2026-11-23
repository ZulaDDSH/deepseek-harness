import { Context } from '@deepseek-ai/cordis'
import { appendFileSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import WebhookRuntime, {
  type WebhookDeliveryId,
  type WebhookRuleId,
  type WebhookSourceId,
  type VerifiedWebhookDelivery,
  type WebhookRule,
} from '../src/index.ts'
import { MAX_JOURNAL_ENTRIES, MAX_REPLAY_ATTEMPTS } from '../src/journal.ts'

const contexts: Context[] = []
let dir: string
let file: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-webhook-journal-'))
  file = join(dir, 'journal.jsonl')
})

afterEach(async () => {
  await Promise.allSettled(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  rmSync(dir, { recursive: true, force: true })
})

function start(journalFile: string | undefined = file): { ctx: Context; runtime: WebhookRuntime } {
  const ctx = new Context()
  contexts.push(ctx)
  return { ctx, runtime: new WebhookRuntime(ctx, journalFile === undefined ? {} : { journalFile }) }
}

function delivery(id = 'delivery-1'): VerifiedWebhookDelivery<'fixture'> {
  return {
    kind: 'fixture',
    source: brandString<WebhookSourceId>('fixture-source'),
    deliveryId: brandString<WebhookDeliveryId>(id),
    event: { value: id },
    receivedAt: 7,
  }
}

function rule(run: WebhookRule<'fixture'>['run'], id = 'rule'): WebhookRule<'fixture'> {
  return { id: brandString<WebhookRuleId>(id), kind: 'fixture', run }
}

const hang = (signal: AbortSignal): Promise<null> =>
  new Promise((_resolve, reject) => { signal.addEventListener('abort', () => { reject(signal.reason) }) })

const settled = async (): Promise<void> => { await new Promise(resolve => setTimeout(resolve, 20)) }

describe('WebhookRuntime journal', () => {
  it('persists a delivery before dispatch returns and replays it for the same rule after a restart', async () => {
    const first = start()
    const entered = Promise.withResolvers<boolean>()
    first.runtime.register(rule((_delivery, signal) => { entered.resolve(true); return hang(signal) }))
    first.runtime.dispatch(delivery())
    expect(readFileSync(file, 'utf8')).toContain('"deliveryId":"delivery-1"')
    await entered.promise
    await first.ctx.fiber.dispose()

    const seen: Readonly<VerifiedWebhookDelivery>[] = []
    const second = start()
    second.runtime.register(rule((input) => { seen.push(input); return null }))
    await settled()
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({ deliveryId: 'delivery-1', receivedAt: 7, event: { value: 'delivery-1' } })
    await second.ctx.fiber.dispose()

    const third = start()
    third.runtime.register(rule(() => { seen.push(delivery()); return null }))
    await settled()
    expect(seen).toHaveLength(1)
  })

  it.skipIf(process.platform === 'win32')('creates the journal readable only by its owner', () => {
    const { runtime } = start()
    runtime.dispatch(delivery())
    expect(statSync(file).mode & 0o777).toBe(0o600)
  })

  it('records a rule failure without retrying it after a restart', async () => {
    const first = start()
    first.runtime.register(rule(() => { throw new Error('boom') }))
    first.runtime.dispatch(delivery())
    await settled()
    expect(readFileSync(file, 'utf8')).toContain('boom')
    await first.ctx.fiber.dispose()

    let runs = 0
    const second = start()
    second.runtime.register(rule(() => { runs++; return null }))
    await settled()
    expect(runs).toBe(0)
    expect(readFileSync(file, 'utf8')).toContain('boom')
  })

  it('gives up on a delivery that keeps interrupting its rule', async () => {
    const first = start()
    first.runtime.register(rule((_delivery, signal) => hang(signal)))
    first.runtime.dispatch(delivery())
    await first.ctx.fiber.dispose()

    let runs = 0
    for (let restart = 0; restart < MAX_REPLAY_ATTEMPTS + 2; restart++) {
      const next = start()
      next.runtime.register(rule((_delivery, signal) => { runs++; return hang(signal) }))
      await settled()
      await next.ctx.fiber.dispose()
    }
    expect(runs).toBe(MAX_REPLAY_ATTEMPTS)
    expect(readFileSync(file, 'utf8')).toContain('interrupted replays')
  })

  it('refuses a delivery when every journal slot holds unfinished work and starts no rule', async () => {
    const { runtime } = start()
    let runs = 0
    runtime.register(rule((_delivery, signal) => { runs++; return hang(signal) }))
    for (let index = 0; index < MAX_JOURNAL_ENTRIES; index++) runtime.dispatch(delivery(`d-${String(index)}`))
    expect(() => { runtime.dispatch(delivery('overflow')) }).toThrow(/full of unfinished deliveries/)
    await settled()
    expect(runs).toBe(MAX_JOURNAL_ENTRIES)
  })

  it('evicts a fully settled failure to admit a new delivery', async () => {
    const { runtime } = start()
    runtime.register(rule(() => { throw new Error('boom') }))
    for (let index = 0; index < MAX_JOURNAL_ENTRIES; index++) runtime.dispatch(delivery(`d-${String(index)}`))
    await settled()
    expect(() => { runtime.dispatch(delivery('next')) }).not.toThrow()
  })

  it('drops a torn final line and refuses a corrupt journal', () => {
    const { runtime } = start()
    runtime.register(rule(() => null))
    appendFileSync(file, '{"op":"add","id":"x"')
    expect(() => start()).not.toThrow()
    writeFileSync(file, '{broken}\n{"op":"drop","id":"x"}\n')
    expect(() => start()).toThrow(/corrupt at line 1/)
  })

  it('defaults to the Host data directory, honours false and prefers an explicit file', async () => {
    const hostFile = join(dir, 'data', 'webhook', 'journal.jsonl')
    const hostCtx = (): Context => {
      const ctx = new Context()
      contexts.push(ctx)
      ctx.provide('dshPath' as never, ((category: string, ...segments: string[]) => join(dir, category, ...segments)) as never)
      return ctx
    }
    const dispatchOne = (runtime: WebhookRuntime): void => {
      runtime.register(rule(() => null))
      runtime.dispatch(delivery())
    }

    dispatchOne(new WebhookRuntime(hostCtx()))
    expect(readFileSync(hostFile, 'utf8')).toContain('"deliveryId":"delivery-1"')
    rmSync(hostFile)

    dispatchOne(new WebhookRuntime(hostCtx(), { journalFile: false }))
    expect(() => readFileSync(hostFile, 'utf8')).toThrow(/ENOENT/)

    dispatchOne(new WebhookRuntime(hostCtx(), { journalFile: file }))
    expect(readFileSync(file, 'utf8')).toContain('"deliveryId":"delivery-1"')
    expect(() => readFileSync(hostFile, 'utf8')).toThrow(/ENOENT/)
  })

  it('is unchanged when no journal is configured', async () => {
    const { runtime } = start(undefined)
    const ran = Promise.withResolvers<boolean>()
    runtime.register(rule(() => { ran.resolve(true); return null }))
    runtime.dispatch(delivery())
    await ran.promise
    expect(() => start('relative/journal.jsonl')).toThrow(/absolute path/)
  })
})

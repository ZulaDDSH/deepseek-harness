/**
 * The authorization Remote namespace as the Models settings page drives it.
 *
 * This is a real composition: the actual `dsh-authorization` registry, the
 * actual memory credential provider, and a flow registered the way an LLM
 * adapter registers one. The controller's own job is the wire half — attempt
 * addressing, notice delivery, prompt correlation, and refusal mapping — so
 * these exercise that through the public surface a browser calls.
 *
 * A notice can carry an authorization URL, a device code, or a prompt, so the
 * isolation suite here is a security contract rather than a convenience: one
 * attempt's notices reach one caller, and no other caller can address it.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AuthorizationService, { AuthorizationError } from '@deepseek-ai/dsh-authorization'
import type { AuthorizationSession } from '@deepseek-ai/dsh-authorization'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import { remoteErrorOf, remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import AuthorizationController from '../src/authorization.ts'
import type { AuthorizationNotice, AuthorizationStart } from '../src/types.ts'
import { MemoryCredentials } from '../../../credentials/credentials/tests/memory.ts'

const CODEX = credentialKey('llm-pi-ai', 'openai-codex')

/** What a flow does once it runs: it reports, asks, and (via the helper) commits. */
type FlowScript = (session: AuthorizationSession) => Promise<void> | void

/**
 * Boot the controller over a real registry and store with one registered flow.
 *
 * The seam holds every flow to its commit contract, so `script` describes what
 * the flow does *before* committing and the helper always commits afterwards —
 * which is what a real login does: talk to the human, then store the grant.
 * @param script - what the registered flow does before it commits; omitted commits immediately.
 * @returns the controller over the booted context.
 */
async function boot(script?: FlowScript): Promise<{
  ctx: Context
  controller: AuthorizationController
}> {
  const ctx = new Context()
  await ctx.plugin(MemoryCredentials, {})
  await ctx.plugin(AuthorizationService)
  await ctx.plugin(AuthorizationController)
  ctx.authorization.registerFlow({
    key: CODEX,
    label: 'OpenAI (ChatGPT Plus/Pro)',
    methods: [{ id: 'oauth', label: 'Sign in with ChatGPT' }],
    async run(session) {
      await script?.(session)
      await ctx.credentials.modifyRecord(CODEX, () => Promise.resolve({
        kind: 'grant',
        payload: { type: 'oauth', access: 'at', refresh: 'rt', expires: 1 },
      }))
    },
  })
  return { ctx, controller: ctx.authorizationController }
}

/** Consume one attempt's stream to completion, recording everything it delivered. */
async function drain(
  stream: AsyncIterable<AuthorizationStart | AuthorizationNotice | { type: 'end' }>,
): Promise<{
  start: AuthorizationStart | undefined
  notices: AuthorizationNotice[]
  ended: boolean
  failure: unknown
}> {
  const notices: AuthorizationNotice[] = []
  let start: AuthorizationStart | undefined
  let ended = false
  try {
    for await (const item of stream) {
      if (item.type === 'start') start = item
      else if (item.type === 'notice') notices.push(item)
      else ended = true
    }
  } catch (error: unknown) {
    return { start, notices, ended, failure: error }
  }
  return { start, notices, ended, failure: undefined }
}

/** Wait for the flow to reach its first parked question. */
async function until(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 0))
  }
  throw new Error('condition never became true')
}

describe('the authorization Remote namespace a configuration surface calls', () => {
  it('publishes the authorization namespace from its own service key', async () => {
    const { controller } = await boot()

    expect(controller.typertRemote.serviceKey).toBe('authorizationController')
    expect(controller.typertRemote.namespace).toBe('authorization')
    expect(remoteMethods(controller).map(entry => entry.method).sort())
      .toEqual(['answer', 'begin', 'cancel', 'list'])
  })

  it('delivers the attempt as a stream rather than a unary result', async () => {
    const { controller } = await boot()

    expect(remoteMethods(controller).find(entry => entry.method === 'begin')?.mode).toBe('stream')
  })

  it('lists each flow with its methods and whether a credential is already stored', async () => {
    const { controller } = await boot()

    expect(await controller.list()).toEqual([{
      key: 'llm-pi-ai/openai-codex',
      label: 'OpenAI (ChatGPT Plus/Pro)',
      methods: [{ id: 'oauth', label: 'Sign in with ChatGPT' }],
      inFlight: false,
      configured: false,
    }])
  })

  it('reports a stored credential on the flow that owns it', async () => {
    const { ctx, controller } = await boot()
    await ctx.credentials.modifyRecord(CODEX, () => Promise.resolve({ kind: 'grant', payload: { token: 't' } }))

    expect((await controller.list())[0]?.configured).toBe(true)
  })

  it('runs the flow and reports authorized once it commits', async () => {
    const { ctx, controller } = await boot()

    const { start, ended } = await drain(controller.begin('llm-pi-ai/openai-codex', undefined, new AbortController().signal))
    expect(start).toMatchObject({ type: 'start', key: 'llm-pi-ai/openai-codex' })
    expect(ended).toBe(true)
    await expect(ctx.credentials.describeRecord(CODEX)).resolves.toMatchObject({ configured: true })
  })

  it('mints an unguessable capability rather than an enumerable id', async () => {
    const seen: string[] = []
    const { controller } = await boot()
    for (let run = 0; run < 3; run += 1) {
      const { start } = await drain(controller.begin('llm-pi-ai/openai-codex', undefined, new AbortController().signal))
      seen.push(start?.attempt ?? '')
    }

    expect(new Set(seen).size).toBe(3)
    for (const capability of seen) {
      expect(capability.length).toBeGreaterThanOrEqual(32)
      expect(capability).not.toContain('openai-codex')
    }
  })

  it('delivers the flow notices on this attempt stream', async () => {
    const { controller } = await boot(async (session) => {
      session.notify({ message: 'Open this page', url: 'https://auth.example/start' })
      session.notify({ message: 'Enter the code', url: 'https://device.example', code: 'WXYZ' })
    })

    const { start, notices } = await drain(controller.begin('llm-pi-ai/openai-codex', undefined, new AbortController().signal))

    expect(notices.map(notice => ({ ...notice, attempt: 'pinned' }))).toEqual([
      { type: 'notice', attempt: 'pinned', message: 'Open this page', url: 'https://auth.example/start' },
      { type: 'notice', attempt: 'pinned', message: 'Enter the code', url: 'https://device.example', code: 'WXYZ' },
    ])
    expect(notices.every(notice => notice.attempt === start?.attempt)).toBe(true)
  })

  it('parks a question until answer settles it, then finishes the flow', async () => {
    let asked: string | undefined
    const { controller } = await boot(async (session) => {
      asked = await session.prompt({ kind: 'text', message: 'Paste the code', placeholder: 'code' })
    })

    const controllerAbort = new AbortController()
    const collected: AuthorizationNotice[] = []
    let capability = ''
    const running = (async () => {
      for await (const item of controller.begin('llm-pi-ai/openai-codex', undefined, controllerAbort.signal)) {
        if (item.type === 'start') capability = item.attempt
        else if (item.type === 'notice') collected.push(item)
      }
    })()

    await until(() => collected.some(notice => notice.prompt !== undefined))
    const question = collected.find(notice => notice.prompt !== undefined)
    expect(question).toMatchObject({ kind: 'text', message: 'Paste the code', placeholder: 'code' })

    controller.answer(capability, question?.prompt ?? '', 'the-code')
    await running
    expect(asked).toBe('the-code')
  })

  it('carries a select question options and answers with the chosen id', async () => {
    let chosen: string | undefined
    const { controller } = await boot(async (session) => {
      chosen = await session.prompt({
        kind: 'select',
        message: 'Which account?',
        options: [{ id: 'work', label: 'Work' }],
      })
    })

    const collected: AuthorizationNotice[] = []
    let capability = ''
    const running = (async () => {
      for await (const item of controller.begin('llm-pi-ai/openai-codex', undefined, new AbortController().signal)) {
        if (item.type === 'start') capability = item.attempt
        else if (item.type === 'notice') collected.push(item)
      }
    })()

    await until(() => collected.some(notice => notice.prompt !== undefined))
    const question = collected.find(notice => notice.prompt !== undefined)
    expect(question?.options).toEqual([{ id: 'work', label: 'Work' }])

    controller.answer(capability, question?.prompt ?? '', 'work')
    await running
    expect(chosen).toBe('work')
  })

  it('refuses an answer to a question that is not awaiting one', async () => {
    const { controller } = await boot(async (session) => {
      await session.prompt({ kind: 'text', message: 'Paste the code' })
    })

    const collected: AuthorizationNotice[] = []
    let capability = ''
    const running = (async () => {
      for await (const item of controller.begin('llm-pi-ai/openai-codex', undefined, new AbortController().signal)) {
        if (item.type === 'start') capability = item.attempt
        else if (item.type === 'notice') collected.push(item)
      }
    })()

    await until(() => collected.some(notice => notice.prompt !== undefined))
    const prompt = collected.find(notice => notice.prompt !== undefined)?.prompt ?? ''
    controller.answer(capability, prompt, 'first')

    const failure = (() => {
      try {
        controller.answer(capability, prompt, 'second')
        return undefined
      } catch (error: unknown) {
        return error
      }
    })()
    expect(remoteErrorOf(failure)?.code).toBe('authorization/not-found')
    await running
  })

  it('reports a capability that is not running rather than hanging', async () => {
    const { controller } = await boot()
    const failure = (() => {
      try {
        controller.answer('guessed-capability', '0', 'x')
        return undefined
      } catch (error: unknown) {
        return error
      }
    })()
    expect(remoteErrorOf(failure)).toMatchObject({ code: 'authorization/not-found' })
  })

  it('delivers the start item before the flow notifies anything', async () => {
    const { controller } = await boot(async (session) => {
      await new Promise<void>((resolve) => {
        if (session.signal.aborted) resolve()
        else session.signal.addEventListener('abort', () => { resolve() }, { once: true })
      })
    })

    const first = await controller.begin('llm-pi-ai/openai-codex', undefined, new AbortController().signal)
      [Symbol.asyncIterator]().next()

    expect(first.value).toMatchObject({ type: 'start', key: 'llm-pi-ai/openai-codex' })
  })

  it('answers a question asked before any notice preceded it', async () => {
    let asked: string | undefined
    const { controller } = await boot(async (session) => {
      asked = await session.prompt({ kind: 'text', message: 'Paste the code' })
    })

    const iterator = controller.begin('llm-pi-ai/openai-codex', undefined, new AbortController().signal)
      [Symbol.asyncIterator]()
    const start = await iterator.next()
    const capability = (start.value as { attempt: string }).attempt
    const question = await iterator.next()
    expect(question.value).toMatchObject({ type: 'notice', prompt: '0' })

    controller.answer(capability, '0', 'the-code')
    await drain({ [Symbol.asyncIterator]: () => iterator })
    expect(asked).toBe('the-code')
  })

  it('settles a withdrawn attempt as cancelled rather than failing it', async () => {
    const { controller } = await boot(async (session) => {
      await session.prompt({ kind: 'text', message: 'Paste the code' })
    })
    const withdraw = new AbortController()

    const running = drain(controller.begin('llm-pi-ai/openai-codex', undefined, withdraw.signal))
    await until(() => !withdraw.signal.aborted)
    withdraw.abort()

    const { failure } = await running
    expect(failure).toBeUndefined()
  })

  it('lets the attempt withdraw itself once its question signal is already aborted', async () => {
    const aborted = new AbortController()
    aborted.abort()
    let reached = false
    const { controller } = await boot(async (session) => {
      try {
        await session.prompt({ kind: 'text', message: 'Paste the code', signal: aborted.signal })
      } catch {
        reached = true
        throw new Error('the question was withdrawn')
      }
    })

    const { failure } = await drain(controller.begin('llm-pi-ai/openai-codex', undefined, new AbortController().signal))

    expect(reached).toBe(true)
    expect(failure).toBeDefined()
  })

  it('reports a flow failure as a rejected stream', async () => {
    const { controller } = await boot(() => Promise.reject(new Error('the grant was refused')))

    const { failure } = await drain(controller.begin('llm-pi-ai/openai-codex', undefined, new AbortController().signal))

    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toContain('the grant was refused')
  })

  it('keeps a genuine flow failure a typed authorization/failed across the stream', async () => {
    const { controller } = await boot(() => Promise.reject(new AuthorizationError('the grant was refused', 'REFUSED')))

    const { failure } = await drain(controller.begin('llm-pi-ai/openai-codex', undefined, new AbortController().signal))

    expect(remoteErrorOf(failure)).toMatchObject({
      code: 'authorization/failed',
      details: { key: 'llm-pi-ai/openai-codex', reason: 'REFUSED' },
    })
    expect((failure as Error).message).toContain('the grant was refused')
  })

  it('refuses a key no flow claims, naming what is missing', async () => {
    const { controller } = await boot()

    const failure = await (async () => {
      try {
        for await (const _item of controller.begin('llm-pi-ai/not-a-provider', undefined, new AbortController().signal)) {
        }
        return undefined
      } catch (error: unknown) {
        return error
      }
    })()
    expect(remoteErrorOf(failure)).toMatchObject({ code: 'authorization/not-found' })
  })

  it('refuses a key outside the credential-record grammar as bad-request', async () => {
    const { controller } = await boot()

    const failure = await (async () => {
      try {
        for await (const _item of controller.begin('NOT A KEY', undefined, new AbortController().signal)) {
        }
        return undefined
      } catch (error: unknown) {
        return error
      }
    })()
    expect(remoteErrorOf(failure)?.code).toBe('gateway/bad-request')
  })
})

describe('one attempt stays private to the caller that started it', () => {
  it('never delivers one caller attempt notices to another caller', async () => {
    const { controller } = await boot(async (session) => {
      session.notify({ message: 'Open this page', url: 'https://auth.example/start', code: 'FIRST-SECRET' })
    })
    const second = await boot(async (session) => {
      session.notify({ message: 'Open this page', url: 'https://auth.example/start', code: 'SECOND-SECRET' })
    })

    const first = await drain(controller.begin('llm-pi-ai/openai-codex', undefined, new AbortController().signal))
    const other = await drain(second.controller.begin('llm-pi-ai/openai-codex', undefined, new AbortController().signal))

    const firstCodes = first.notices.map(notice => notice.code)
    const otherCodes = other.notices.map(notice => notice.code)
    expect(firstCodes).toContain('FIRST-SECRET')
    expect(firstCodes).not.toContain('SECOND-SECRET')
    expect(otherCodes).toContain('SECOND-SECRET')
    expect(otherCodes).not.toContain('FIRST-SECRET')
  })

  it('refuses an answer addressed by another caller capability', async () => {
    const { controller } = await boot(async (session) => {
      await session.prompt({ kind: 'text', message: 'Paste the code' })
    })

    let mine = ''
    const collected: AuthorizationNotice[] = []
    const running = (async () => {
      for await (const item of controller.begin('llm-pi-ai/openai-codex', undefined, new AbortController().signal)) {
        if (item.type === 'start') mine = item.attempt
        else if (item.type === 'notice') collected.push(item)
      }
    })()
    await until(() => collected.some(notice => notice.prompt !== undefined))
    const prompt = collected.find(notice => notice.prompt !== undefined)?.prompt ?? ''

    const failure = (() => {
      try {
        controller.answer('another-callers-capability', prompt, 'stolen')
        return undefined
      } catch (error: unknown) {
        return error
      }
    })()
    expect(remoteErrorOf(failure)?.code).toBe('authorization/not-found')

    controller.answer(mine, prompt, 'mine')
    await running
  })

  it('refuses a cancel addressed by another caller capability', async () => {
    const { controller } = await boot(async (session) => {
      await session.prompt({ kind: 'text', message: 'Paste the code' })
    })

    let mine = ''
    const collected: AuthorizationNotice[] = []
    const running = (async () => {
      for await (const item of controller.begin('llm-pi-ai/openai-codex', undefined, new AbortController().signal)) {
        if (item.type === 'start') mine = item.attempt
        else if (item.type === 'notice') collected.push(item)
      }
    })()
    await until(() => collected.some(notice => notice.prompt !== undefined))
    const prompt = collected.find(notice => notice.prompt !== undefined)?.prompt ?? ''

    const failure = (() => {
      try {
        controller.cancel('another-callers-capability')
        return undefined
      } catch (error: unknown) {
        return error
      }
    })()
    expect(remoteErrorOf(failure)?.code).toBe('authorization/not-found')

    controller.answer(mine, prompt, 'mine')
    await running
  })
})

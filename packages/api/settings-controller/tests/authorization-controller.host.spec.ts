/**
 * The authorization Remote namespace as the Models settings page drives it.
 *
 * This is a real composition: the actual `dsh-authorization` registry, the
 * actual memory credential provider, and a flow registered the way an LLM
 * adapter registers one. The controller's own job is the wire half — attempt
 * addressing, prompt correlation, and refusal mapping — so these exercise that
 * through the public methods a browser calls.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AuthorizationService from '@deepseek-ai/dsh-authorization'
import type { AuthorizationNoticeEvent, AuthorizationSession } from '@deepseek-ai/dsh-authorization'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import { remoteErrorOf, remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import AuthorizationController from '../src/authorization.ts'
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
 * @returns the controller plus the notices every listener saw.
 */
async function boot(script?: FlowScript): Promise<{
  ctx: Context
  controller: AuthorizationController
  notices: AuthorizationNoticeEvent[]
}> {
  const ctx = new Context()
  await ctx.plugin(MemoryCredentials, {})
  await ctx.plugin(AuthorizationService)
  await ctx.plugin(AuthorizationController)
  const notices: AuthorizationNoticeEvent[] = []
  ctx.on('authorization/notice', (notice) => { notices.push(notice) })
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
  return { ctx, controller: ctx.authorizationController, notices }
}

describe('the authorization Remote namespace a configuration surface calls', () => {
  it('publishes the authorization namespace from its own service key', async () => {
    const { controller } = await boot()

    expect(controller.typertRemote.serviceKey).toBe('authorizationController')
    expect(controller.typertRemote.namespace).toBe('authorization')
    expect(remoteMethods(controller).map(entry => entry.method).sort())
      .toEqual(['answer', 'begin', 'cancel', 'list'])
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

    await expect(controller.begin('llm-pi-ai/openai-codex', undefined, new AbortController().signal))
      .resolves.toEqual({ status: 'authorized' })
    await expect(ctx.credentials.describeRecord(CODEX)).resolves.toMatchObject({ configured: true })
  })

  it('publishes the flow notices addressed to this attempt', async () => {
    const { controller, notices } = await boot(async (session) => {
      session.notify({ message: 'Open this page', url: 'https://auth.example/start' })
      session.notify({ message: 'Enter the code', url: 'https://device.example', code: 'WXYZ' })
    })

    await controller.begin('llm-pi-ai/openai-codex', undefined, new AbortController().signal)

    expect(notices.map(({ attempt, key, ...rest }) => ({ attempt: attempt.length > 0, key, ...rest }))).toEqual([
      { attempt: true, key: 'llm-pi-ai/openai-codex', message: 'Open this page', url: 'https://auth.example/start' },
      { attempt: true, key: 'llm-pi-ai/openai-codex', message: 'Enter the code', url: 'https://device.example', code: 'WXYZ' },
    ])
  })

  it('parks a question until answer settles it, then finishes the flow', async () => {
    let asked: string | undefined
    const { controller, notices } = await boot(async (session) => {
      asked = await session.prompt({ kind: 'text', message: 'Paste the code', placeholder: 'code' })
    })

    const running = controller.begin('llm-pi-ai/openai-codex', undefined, new AbortController().signal)
    // The prompt reaches the surface before the flow can proceed.
    await Promise.resolve()
    const question = notices.find(notice => notice.prompt !== undefined)
    expect(question).toMatchObject({
      key: 'llm-pi-ai/openai-codex',
      kind: 'text',
      message: 'Paste the code',
      placeholder: 'code',
    })

    controller.answer(question?.attempt ?? '', question?.prompt ?? '', 'the-code')
    await expect(running).resolves.toEqual({ status: 'authorized' })
    expect(asked).toBe('the-code')
  })

  it('carries a select question options and answers with the chosen id', async () => {
    let chosen: string | undefined
    const { controller, notices } = await boot(async (session) => {
      chosen = await session.prompt({
        kind: 'select',
        message: 'Which account?',
        options: [{ id: 'work', label: 'Work' }],
      })
    })

    const running = controller.begin('llm-pi-ai/openai-codex', undefined, new AbortController().signal)
    await Promise.resolve()
    const question = notices.find(notice => notice.prompt !== undefined)
    expect(question?.options).toEqual([{ id: 'work', label: 'Work' }])

    controller.answer(question?.attempt ?? '', question?.prompt ?? '', 'work')
    await running
    expect(chosen).toBe('work')
  })

  it('refuses an answer to a question that is not awaiting one', async () => {
    const { controller, notices } = await boot(async (session) => {
      await session.prompt({ kind: 'text', message: 'Paste the code' })
    })

    const running = controller.begin('llm-pi-ai/openai-codex', undefined, new AbortController().signal)
    await Promise.resolve()
    const question = notices.find(notice => notice.prompt !== undefined)
    controller.answer(question?.attempt ?? '', question?.prompt ?? '', 'first')

    const failure = (() => {
      try {
        controller.answer(question?.attempt ?? '', question?.prompt ?? '', 'second')
        return undefined
      } catch (error: unknown) {
        return error
      }
    })()
    expect(remoteErrorOf(failure)?.code).toBe('authorization/not-found')
    await running
  })

  it('reports an attempt id that is not running rather than hanging', async () => {
    const { controller } = await boot()
    const failure = (() => {
      try {
        controller.answer('auth-999', '0', 'x')
        return undefined
      } catch (error: unknown) {
        return error
      }
    })()
    expect(remoteErrorOf(failure)).toMatchObject({ code: 'authorization/not-found' })
  })

  it('settles a withdrawn attempt as cancelled rather than failing it', async () => {
    const { controller } = await boot(async (session) => {
      await session.prompt({ kind: 'text', message: 'Paste the code' })
    })
    const withdraw = new AbortController()

    const running = controller.begin('llm-pi-ai/openai-codex', undefined, withdraw.signal)
    await Promise.resolve()
    withdraw.abort()

    await expect(running).resolves.toEqual({ status: 'cancelled' })
  })

  it('reports a flow failure as authorization/failed naming the key', async () => {
    const { controller } = await boot(() => Promise.reject(new Error('the grant was refused')))

    const failure = await controller.begin('llm-pi-ai/openai-codex', undefined, new AbortController().signal)
      .catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({
      code: 'authorization/failed',
      message: 'the grant was refused',
      details: { key: 'llm-pi-ai/openai-codex' },
    })
  })

  it('refuses a key no flow claims, naming what is missing', async () => {
    const { controller } = await boot()

    const failure = await controller.begin('llm-pi-ai/not-a-provider', undefined, new AbortController().signal)
      .catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({ code: 'authorization/not-found' })
  })

  it('refuses a key outside the credential-record grammar as bad-request', async () => {
    const { controller } = await boot()

    const failure = await controller.begin('NOT A KEY', undefined, new AbortController().signal)
      .catch((error: unknown) => error)
    expect(remoteErrorOf(failure)?.code).toBe('gateway/bad-request')
  })
})

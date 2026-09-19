// @vitest-environment jsdom
/**
 * The Models-page sign-in card over a scripted authorization surface.
 *
 * The card is the only place a human sees an authorization URL, a device code,
 * or a question, so these pin what it does with each: it renders what the Host
 * streams, keeps a question on screen when the Host refuses an answer, and
 * reports a completed sign-in so the page refreshes the provider it just
 * authorized.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SignInCard } from '../src/client/SignInCard.tsx'
import type { AuthorizationOperations } from '../src/client/authorization-operations.ts'
import type { AuthorizationNotice } from '@deepseek-ai/dsh-api-settings-controller/types'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t = (key: keyof typeof en, params?: Record<string, string>): string => {
  const template = en[key]
  if (params === undefined) return template
  return Object.entries(params).reduce(
    (copy, [name, value]) => copy.replace(`{${name}}`, value), template)
}

const ENTRY = {
  key: 'llm-pi-ai/openai-codex',
  label: 'OpenAI Codex',
  methods: [{ id: 'oauth', label: 'Sign in with ChatGPT' }],
  inFlight: false,
  configured: false,
}

/**
 * A scripted authorization surface. `notices` are pushed to the card during
 * `begin`, exactly as the Host's stream would. With `hold` the attempt stays
 * open after its notices — as a real flow does while it waits for an answer —
 * until `release` is called.
 */
function surface(options: {
  notices?: readonly AuthorizationNotice[]
  answer?: () => Promise<{ kind: 'accepted' } | { kind: 'refused'; message: string }>
  outcome?: 'authorized' | 'cancelled' | { kind: 'failed'; message: string }
  configured?: boolean
  hold?: boolean
} = {}): AuthorizationOperations & {
  answered: { attempt: string; prompt: string; value: string }[]
  release: () => void
} {
  const answered: { attempt: string; prompt: string; value: string }[] = []
  let release = (): void => {}
  const held = new Promise<void>((resolve) => { release = resolve })
  return {
    answered,
    release: () => { release() },
    list: () => Promise.resolve([{ ...ENTRY, configured: options.configured ?? false }]),
    begin: async (_key, _method, onItem) => {
      onItem({ type: 'start', attempt: 'cap-1', key: ENTRY.key })
      for (const notice of options.notices ?? []) onItem(notice)
      if (options.hold === true) await held
      const outcome = options.outcome ?? 'authorized'
      if (outcome === 'authorized') {
        onItem({ type: 'end', status: 'authorized' })
        return { kind: 'authorized' }
      }
      if (outcome === 'cancelled') {
        onItem({ type: 'end', status: 'cancelled' })
        return { kind: 'cancelled' }
      }
      return outcome
    },
    answer: async (attempt, prompt, value) => {
      answered.push({ attempt, prompt, value })
      return options.answer === undefined ? { kind: 'accepted' } : options.answer()
    },
  }
}

/** Start the attempt and wait for the card to be running. */
async function start(operations: AuthorizationOperations, onSignedIn?: () => void): Promise<void> {
  render(
    <SignInCard
      provider="openai-codex"
      displayName="OpenAI Codex"
      operations={operations}
      t={t}
      {...onSignedIn === undefined ? {} : { onSignedIn }}
    />,
  )
  const button = await screen.findByRole('button', { name: en.signIn })
  fireEvent.click(button)
}

describe('the sign-in card', () => {
  it('offers sign-in only for a route that has a flow', async () => {
    const operations = surface()
    render(
      <SignInCard provider="some-other-route" displayName="Other" operations={operations} t={t} />,
    )

    // No flow for this route means the API-key field is the only way in.
    await waitFor(() => { expect(screen.queryByRole('button', { name: en.signIn })).toBeNull() })
  })

  it('renders a notice with its authorization page and code', async () => {
    const operations = surface({
      hold: true,
      notices: [{
        type: 'notice',
        attempt: 'cap-1',
        message: 'Enter this code on the verification page.',
        url: 'https://device.example',
        code: 'WXYZ-1234',
      }],
    })
    await start(operations)

    expect(await screen.findByText('Enter this code on the verification page.')).toBeTruthy()
    expect(screen.getByText('WXYZ-1234')).toBeTruthy()
    const link = screen.getByRole('link', { name: en.signInOpenPage })
    expect(link.getAttribute('href')).toBe('https://device.example')
    operations.release()
  })

  it('keeps a refused answer on screen with the Host reason', async () => {
    const operations = surface({
      hold: true,
      notices: [{
        type: 'notice', attempt: 'cap-1', prompt: '0', kind: 'text', message: 'Paste the code',
      }],
      answer: () => Promise.resolve({ kind: 'refused', message: 'that question is not awaiting an answer' }),
    })
    await start(operations)

    const input = await screen.findByLabelText('Paste the code')
    fireEvent.change(input, { target: { value: 'the-code' } })
    fireEvent.click(screen.getByRole('button', { name: en.signInSubmit }))

    // The Host refused it, so the prompt must survive with its diagnostic rather
    // than vanish and strand the flow.
    expect(await screen.findByText(en.signInAnswerFailed.replace('{message}', 'that question is not awaiting an answer')))
      .toBeTruthy()
    expect(screen.getByLabelText('Paste the code')).toBeTruthy()
    operations.release()
  })

  it('clears the question only after the Host accepts the answer', async () => {
    const operations = surface({
      hold: true,
      notices: [{
        type: 'notice', attempt: 'cap-1', prompt: '0', kind: 'text', message: 'Paste the code',
      }],
    })
    await start(operations)

    const input = await screen.findByLabelText('Paste the code')
    fireEvent.change(input, { target: { value: 'the-code' } })
    fireEvent.click(screen.getByRole('button', { name: en.signInSubmit }))

    await waitFor(() => { expect(screen.queryByLabelText('Paste the code')).toBeNull() })
    expect(operations.answered).toEqual([{ attempt: 'cap-1', prompt: '0', value: 'the-code' }])
    operations.release()
  })

  it('reports a completed sign-in so the page can refresh the provider', async () => {
    const onSignedIn = vi.fn()
    await start(surface(), onSignedIn)

    await waitFor(() => { expect(onSignedIn).toHaveBeenCalledTimes(1) })
  })

  it('does not report a withdrawn attempt as a completed sign-in', async () => {
    const onSignedIn = vi.fn()
    await start(surface({ outcome: 'cancelled' }), onSignedIn)

    expect(await screen.findByText(en.signInCancelled)).toBeTruthy()
    expect(onSignedIn).not.toHaveBeenCalled()
  })

  it('shows a flow failure with the Host diagnostic', async () => {
    await start(surface({ outcome: { kind: 'failed', message: 'the grant was refused' } }))

    expect(await screen.findByText(en.signInFailed.replace('{message}', 'the grant was refused'))).toBeTruthy()
  })
})

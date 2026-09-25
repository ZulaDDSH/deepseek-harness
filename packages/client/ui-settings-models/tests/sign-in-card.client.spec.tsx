// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AuthorizationEntryView, AuthorizationNotice } from '@deepseek-ai/dsh-api-settings-controller/types'
import { PiAiAuthorizationCard } from '../src/client/PiAiAuthorizationCard.tsx'
import type { AuthorizationOperations, AttemptStreamItem, AuthorizationOutcome } from '../src/client/authorization-operations.ts'
import { SignInCard } from '../src/client/SignInCard.tsx'
import type { PiAiAuthorizationCardProps } from '../src/client/PiAiAuthorizationCard.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t = (key: keyof typeof en, params?: Record<string, string>): string =>
  Object.entries(params ?? {}).reduce((value, [name, replacement]) => value.replace(`{${name}}`, replacement), en[key])

function flow(overrides: Partial<AuthorizationEntryView> = {}): AuthorizationEntryView {
  return {
    key: 'provider/openai', label: 'OpenAI', methods: [{ id: 'oauth', label: 'Browser sign-in' }],
    inFlight: false, configured: false, ...overrides,
  }
}

function harness(overrides: Partial<AuthorizationOperations> = {}) {
  let emit!: (item: AttemptStreamItem) => void
  let finish!: (outcome: AuthorizationOutcome) => void
  const operations: AuthorizationOperations = {
    list: vi.fn<AuthorizationOperations['list']>(async () => [flow()]),
    begin: vi.fn<AuthorizationOperations['begin']>((_key, _method, onItem) => new Promise<AuthorizationOutcome>((resolve) => {
      emit = onItem
      finish = resolve
    })),
    answer: vi.fn(async () => ({ kind: 'accepted' as const })),
    cancel: vi.fn(async () => {}),
    ...overrides,
  }
  return { operations, emit: (item: AttemptStreamItem) => emit(item), finish: (outcome: AuthorizationOutcome) => finish(outcome) }
}

function renderCard(operations: AuthorizationOperations, props: { refresh?: number; onSignedIn?: () => void } = {}) {
  return render(
    <SignInCard provider="openai" displayName="OpenAI" operations={operations} t={t} {...props} />,
  )
}

async function ready(): Promise<void> {
  await screen.findByRole('button', { name: en.signIn })
}

describe('SignInCard', () => {
  it('keeps unavailable routes hidden and ignores a listing that settles after unmount', async () => {
    const hidden = harness({ list: vi.fn<AuthorizationOperations['list']>(async () => []) })
    const hiddenView = renderCard(hidden.operations)
    await waitFor(() => expect(hidden.operations.list).toHaveBeenCalledOnce())
    expect(screen.queryByRole('button', { name: en.signIn })).toBeNull()
    hiddenView.unmount()

    let resolveList!: (value: readonly AuthorizationEntryView[]) => void
    const late = harness({ list: vi.fn<AuthorizationOperations['list']>(() => new Promise((resolve) => { resolveList = resolve })) })
    const lateView = renderCard(late.operations)
    await waitFor(() => expect(late.operations.list).toHaveBeenCalledOnce())
    lateView.unmount()
    await act(async () => resolveList([flow()]))
  })

  it('streams notices, remembers early cancel, retries a refused answer, and reloads after sign-in', async () => {
    const signedIn = vi.fn()
    const listed = vi.fn<AuthorizationOperations['list']>()
      .mockResolvedValueOnce([flow()]).mockResolvedValueOnce([flow({ configured: true })])
    const answer = vi.fn<AuthorizationOperations['answer']>()
      .mockResolvedValueOnce({ kind: 'refused', message: 'try again' }).mockResolvedValueOnce({ kind: 'accepted' })
    const api = harness({ list: listed, answer })
    renderCard(api.operations, { onSignedIn: signedIn })
    await ready()
    fireEvent.click(screen.getByRole('button', { name: en.signIn }))
    fireEvent.click(screen.getByRole('button', { name: en.signInCancel }))
    act(() => api.emit({ type: 'start', attempt: 'attempt-1', key: 'provider/openai' }))
    await waitFor(() => expect(api.operations.cancel).toHaveBeenCalledWith('attempt-1'))
    const notice: AuthorizationNotice = {
      type: 'notice', attempt: 'attempt-1', message: 'Open the browser', code: 'ABCD', url: 'https://example.test/login',
    }
    act(() => api.emit(notice))
    expect(screen.getByText('ABCD')).toBeTruthy()
    expect(screen.getByRole('link', { name: en.signInOpenPage }).getAttribute('href')).toBe('https://example.test/login')
    act(() => api.emit({ type: 'notice', attempt: 'attempt-1', message: 'Waiting for browser' }))
    act(() => api.emit({
      type: 'notice', attempt: 'attempt-1', message: 'Paste the code', prompt: 'prompt-1', kind: 'text', placeholder: 'Code',
    }))
    const input = await screen.findByLabelText('Paste the code')
    fireEvent.change(input, { target: { value: 'answer' } })
    fireEvent.click(screen.getByRole('button', { name: en.signInSubmit }))
    expect(await screen.findByText(t('signInAnswerFailed', { message: 'try again' }))).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.signInSubmit }))
    await waitFor(() => expect(screen.queryByLabelText('Paste the code')).toBeNull())
    act(() => api.emit({ type: 'end', status: 'authorized' }))
    await act(async () => api.finish({ kind: 'authorized' }))
    await waitFor(() => expect(screen.getByText(en.signedIn)).toBeTruthy())
    expect(listed).toHaveBeenCalledTimes(2)
    expect(signedIn).toHaveBeenCalledOnce()
    expect(answer).toHaveBeenNthCalledWith(1, 'attempt-1', 'prompt-1', 'answer')
    expect(answer).toHaveBeenNthCalledWith(2, 'attempt-1', 'prompt-1', 'answer')
  })

  it('handles late stream items and keeps a replacement question after an older answer resolves', async () => {
    let resolveAnswer!: (outcome: { kind: 'accepted' }) => void
    const answer = vi.fn<AuthorizationOperations['answer']>()
      .mockImplementationOnce(() => new Promise((resolve) => { resolveAnswer = resolve }))
      .mockResolvedValueOnce({ kind: 'accepted' })
    const api = harness({ answer })
    const view = renderCard(api.operations)
    await ready()
    fireEvent.click(screen.getByRole('button', { name: en.signIn }))
    act(() => api.emit({ type: 'start', attempt: 'attempt-late', key: 'provider/openai' }))
    act(() => api.emit({ type: 'notice', attempt: 'attempt-late', message: 'First question', prompt: 'first' }))
    fireEvent.change(await screen.findByLabelText('First question'), { target: { value: 'one' } })
    fireEvent.click(screen.getByRole('button', { name: en.signInSubmit }))
    act(() => api.emit({ type: 'notice', attempt: 'attempt-late', message: 'Second question', prompt: 'second' }))
    await act(async () => resolveAnswer({ kind: 'accepted' }))
    expect(screen.getByLabelText('Second question')).toBeTruthy()
    act(() => api.emit({ type: 'end', status: 'cancelled' }))
    await act(async () => api.finish({ kind: 'cancelled' }))
    act(() => api.emit({ type: 'start', attempt: 'late-start', key: 'provider/openai' }))
    act(() => api.emit({ type: 'notice', attempt: 'late-start', message: 'Late progress' }))
    act(() => api.emit({ type: 'notice', attempt: 'late-start', message: 'Default text', prompt: 'default-prompt' }))
    expect(screen.getByText(en.signInCancelled)).toBeTruthy()
    expect((screen.getByLabelText('Default text') as HTMLInputElement).type).toBe('text')
    view.unmount()
    act(() => api.emit({ type: 'notice', attempt: 'late-start', message: 'After unmount' }))
  })

  it('answers select and secret prompts and ignores an answer that settles after unmount', async () => {
    const answer = vi.fn<AuthorizationOperations['answer']>()
      .mockResolvedValueOnce({ kind: 'accepted' }).mockResolvedValueOnce({ kind: 'accepted' })
    const api = harness({ answer })
    const view = renderCard(api.operations)
    await ready()
    fireEvent.click(screen.getByRole('button', { name: en.signIn }))
    act(() => api.emit({ type: 'start', attempt: 'attempt-2', key: 'provider/openai' }))
    act(() => api.emit({
      type: 'notice', attempt: 'attempt-2', message: 'Choose account', prompt: 'prompt-2', kind: 'select',
      options: [{ id: 'work', label: 'Work account' }],
    }))
    fireEvent.click(await screen.findByRole('button', { name: 'Work account' }))
    await waitFor(() => expect(answer).toHaveBeenNthCalledWith(1, 'attempt-2', 'prompt-2', 'work'))
    act(() => api.emit({
      type: 'notice', attempt: 'attempt-2', message: 'Choose no options', prompt: 'prompt-empty', kind: 'select',
    }))
    expect(await screen.findByText('Choose no options')).toBeTruthy()
    act(() => api.emit({
      type: 'notice', attempt: 'attempt-2', message: 'Enter token', prompt: 'prompt-3', kind: 'secret',
    }))
    const input = await screen.findByLabelText('Enter token') as HTMLInputElement
    expect(input.type).toBe('password')
    expect(input.placeholder).toBe('')
    fireEvent.keyDown(input, { key: 'Tab' })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.change(input, { target: { value: 'secret' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(answer).toHaveBeenNthCalledWith(2, 'attempt-2', 'prompt-3', 'secret'))
    view.unmount()
    await act(async () => api.finish({ kind: 'cancelled' }))
  })

  it('ignores an answer that settles after unmount and permits sign-in without a completion callback', async () => {
    let resolveAnswer!: (outcome: { kind: 'accepted' }) => void
    const answer = vi.fn<AuthorizationOperations['answer']>(() => new Promise((resolve) => { resolveAnswer = resolve }))
    const api = harness({ answer })
    const view = renderCard(api.operations)
    await ready()
    fireEvent.click(screen.getByRole('button', { name: en.signIn }))
    act(() => api.emit({ type: 'start', attempt: 'attempt-answer', key: 'provider/openai' }))
    act(() => api.emit({ type: 'notice', attempt: 'attempt-answer', message: 'Code', prompt: 'code' }))
    fireEvent.change(await screen.findByLabelText('Code'), { target: { value: 'abc' } })
    fireEvent.click(screen.getByRole('button', { name: en.signInSubmit }))
    view.unmount()
    await act(async () => resolveAnswer({ kind: 'accepted' }))

    const completed = harness({ begin: vi.fn(async () => ({ kind: 'authorized' as const })) })
    renderCard(completed.operations)
    await ready()
    fireEvent.click(screen.getByRole('button', { name: en.signIn }))
    await waitFor(() => expect(completed.operations.list).toHaveBeenCalledTimes(2))
  })

  it('shows failed and cancelled outcomes, retries with an empty method, and cancels a named attempt', async () => {
    const begin = vi.fn()
      .mockResolvedValueOnce({ kind: 'failed', message: 'network down' })
      .mockResolvedValueOnce({ kind: 'cancelled' })
    const api = harness({ list: vi.fn(async () => [flow({ methods: [] })]), begin })
    renderCard(api.operations)
    await ready()
    fireEvent.click(screen.getByRole('button', { name: en.signIn }))
    expect(await screen.findByText(t('signInFailed', { message: 'network down' }))).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.signInRetry }))
    expect(await screen.findByText(en.signInCancelled)).toBeTruthy()
    expect(begin).toHaveBeenNthCalledWith(1, 'provider/openai', '', expect.any(Function), expect.any(AbortSignal))
    expect(begin).toHaveBeenNthCalledWith(2, 'provider/openai', '', expect.any(Function), expect.any(AbortSignal))

    const named = harness()
    renderCard(named.operations)
    await ready()
    fireEvent.click(screen.getAllByRole('button', { name: en.signIn })[0]!)
    act(() => named.emit({ type: 'start', attempt: 'attempt-3', key: 'provider/openai' }))
    fireEvent.click(await screen.findByRole('button', { name: en.signInCancel }))
    expect(named.operations.cancel).toHaveBeenCalledWith('attempt-3')
  })

  it('aborts the active attempt when the card unmounts', async () => {
    const api = harness()
    const view = renderCard(api.operations)
    await ready()
    fireEvent.click(screen.getByRole('button', { name: en.signIn }))
    const signal = (api.operations.begin as ReturnType<typeof vi.fn>).mock.calls[0]?.[3] as AbortSignal
    view.unmount()
    expect(signal.aborted).toBe(true)
    await act(async () => api.finish({ kind: 'cancelled' }))
  })
})

describe('PiAiAuthorizationCard', () => {
  it('uses key configuration as the reload signal and refreshes Models after authorization', async () => {
    const api = harness()
    const load = vi.fn(async () => {})
    const props: PiAiAuthorizationCardProps = {
      provider: { provider: 'openai', displayName: 'OpenAI', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'openai'], active: true },
      configured: true, keyConfigured: false, authorization: api.operations,
      controller: { load } as never, t,
    }
    const view = render(<PiAiAuthorizationCard {...props} />)
    await ready()
    view.rerender(<PiAiAuthorizationCard {...props} keyConfigured />)
    await waitFor(() => expect(api.operations.list).toHaveBeenCalledTimes(2))
    fireEvent.click(screen.getByRole('button', { name: en.signIn }))
    act(() => api.emit({ type: 'start', attempt: 'attempt-4', key: 'provider/openai' }))
    await act(async () => api.finish({ kind: 'authorized' }))
    await waitFor(() => expect(load).toHaveBeenCalledOnce())
  })
})

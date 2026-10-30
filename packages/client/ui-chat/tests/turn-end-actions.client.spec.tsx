// @vitest-environment jsdom

import type { SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import type { InputActions, InputState } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  ChatNode, ChatNodeViewProps, ChatSnapshot, ConversationNode, TurnErrorNode,
  TurnMaxTokensNode, UserMessageNode,
} from '@deepseek-ai/dsh-client-ui-chat/client'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { en, zh } from '../src/client/locale.ts'
import { TurnErrorNodeView, TurnMaxTokensNodeView } from '../src/client/chat/MessageItem.tsx'
import { chatSnapshotFixture } from './chat-snapshot-fixture.client.ts'

afterEach(cleanup)

const unused = (): never => { throw new Error('turn-end action fixture does not provide this action') }
const t = makeTranslate(en, commonEn)
const RETRY_HINT = 'Send this turn’s message text again (attachments are not included)'

const userTurn = (seq: number, text: string, turn: number): UserMessageNode & { readonly turn: number } => ({
  kind: 'user', seq, time: seq * 1_000, turn, source: null,
  content: [{ type: 'text', text }],
})
const turnError = (code?: string, turn = 1, message = 'raw provider text'): TurnErrorNode => ({
  kind: 'turn-error', seq: 2, time: 2_000, turn, step: 0, message,
  ...(code === undefined ? {} : { code }),
})
const turnMaxTokens = (turn = 1): TurnMaxTokensNode => ({
  kind: 'turn-max-tokens', seq: 3, time: 3_000, turn, step: 0,
})

interface FixtureOptions {
  readonly running?: boolean
  readonly draft?: string
}

/** Chat, Session and composer seats over one transcript. */
function fixture(nodes: readonly ConversationNode[], { running = false, draft = '' }: FixtureOptions = {}) {
  const snapshot = chatSnapshotFixture({ nodes })
  const setDraft = vi.fn()
  const submit = vi.fn()
  const inputActions: InputActions = {
    insertQuote: unused,
    captureInsertion: unused,
    insertText: unused,
    setDraft,
    persistDraft: unused,
    addAttachments: unused,
    removeAttachment: unused,
    pruneAttachments: unused,
    submit,
  }
  const useChat: ChatNodeViewProps<'turn-error'>['useChat'] = selector => selector(snapshot)
  const useSession: ChatNodeViewProps<'turn-error'>['useSession'] = selector => selector({ running } as SessionSnapshot)
  const composer: Pick<InputState, 'phase' | 'draft' | 'attachmentIds'> = { phase: 'plain', draft, attachmentIds: [] }
  const useInput: ChatNodeViewProps<'turn-error'>['useInput'] = selector => selector(composer as InputState)
  return { snapshot, setDraft, submit, inputActions, useChat, useSession, useInput }
}

type Fixture = ReturnType<typeof fixture>

function nodeOf<Kind extends 'turn-error' | 'turn-max-tokens'>(snapshot: ChatSnapshot, kind: Kind): ChatNode<Kind> {
  const node = snapshot.nodes.values().find(candidate => candidate.kind === kind)
  if (node === undefined) throw new Error(`fixture has no ${kind} node`)
  return node as ChatNode<Kind>
}

type ErrorProps = ChatNodeViewProps<'turn-error'>
type MaxTokensProps = ChatNodeViewProps<'turn-max-tokens'>

/** The seats a terminal-turn renderer reads. */
function seatsOf(f: Fixture) {
  return {
    useChat: f.useChat,
    useSession: f.useSession,
    useInput: f.useInput,
    inputActions: f.inputActions,
    t: t as ErrorProps['t'],
  }
}

function errorProps(f: Fixture): ErrorProps {
  return { ...seatsOf(f), node: nodeOf(f.snapshot, 'turn-error') } as ErrorProps
}

function maxTokensProps(f: Fixture): MaxTokensProps {
  return { ...seatsOf(f), node: nodeOf(f.snapshot, 'turn-max-tokens') } as MaxTokensProps
}

describe('turn-error copy', () => {
  it.each([
    ['AUTH', 'API key is invalid'],
    ['MISSING_CREDENTIAL', 'No credential is configured for this provider. Add one in Settings.'],
    ['INVALID_CREDENTIAL', 'The stored credential for this provider is malformed. Update it in Settings.'],
    ['RATE_LIMIT', 'The provider is limiting the request rate. Wait a moment, then retry.'],
    ['QUOTA', 'Request quota exhausted.'],
  ])('renders the %s failure as inline copy with no transient notice', (code, copy) => {
    const f = fixture([userTurn(1, 'fix the build', 1), turnError(code)])
    render(<TurnErrorNodeView {...errorProps(f)} />)
    expect(screen.getByRole('status').textContent).toContain(copy)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows the raw provider message for an unknown or absent code', () => {
    const f = fixture([userTurn(1, 'fix the build', 1), turnError('UNMAPPED')])
    render(<TurnErrorNodeView {...errorProps(f)} />)
    expect(screen.getByRole('status').textContent).toContain('raw provider text')
  })
})

const USAGE_LIMIT_BODY = '400 {"type":"error","error":{"type":"invalid_request_error","message":"You have reached your specified API usage limits. You will regain access on 2026-11-01 at 00:00 UTC."}}'

describe('turn-error provider usage limit', () => {
  it('explains the spending limit with the regain date and keeps the raw body expandable', () => {
    const f = fixture([userTurn(1, 'fix the build', 1), turnError(undefined, 1, USAGE_LIMIT_BODY)])
    render(<TurnErrorNodeView {...errorProps(f)} />)
    const status = screen.getByRole('status')
    expect(status.textContent).toContain('The provider spending limit was reached. Access returns on 2026-11-01 at 00:00 UTC. Raise the limit in the provider console, or pick another model or route.')
    expect(status.querySelector('details')?.hasAttribute('open')).toBe(false)
    expect(status.querySelector('details pre')?.textContent).toBe(USAGE_LIMIT_BODY)
  })

  it('omits the date sentence when the provider names none', () => {
    const body = USAGE_LIMIT_BODY.replace(' You will regain access on 2026-11-01 at 00:00 UTC.', '')
    const f = fixture([userTurn(1, 'fix the build', 1), turnError(undefined, 1, body)])
    render(<TurnErrorNodeView {...errorProps(f)} />)
    expect(screen.getByRole('status').textContent).toContain('The provider spending limit was reached. Raise the limit')
    expect(screen.getByRole('status').textContent).not.toContain('Access returns on')
  })

  it('leaves other invalid_request_error failures as the raw message', () => {
    const f = fixture([userTurn(1, 'fix the build', 1), turnError(undefined, 1, '400 {"error":{"type":"invalid_request_error","message":"max_tokens is too large"}}')])
    render(<TurnErrorNodeView {...errorProps(f)} />)
    expect(screen.getByRole('status').textContent).toContain('max_tokens is too large')
    expect(screen.getByRole('status').querySelector('details')).toBeNull()
  })

  it('has a Chinese message with the date', () => {
    expect(zh['message.failure.usageLimit']).toContain('{date}')
    expect(zh['message.failure.usageLimit.noDate']).not.toContain('{date}')
  })
})

describe('turn-error retry', () => {
  it('re-sends the turn prompt through the composer on the latest idle turn', () => {
    const f = fixture([userTurn(1, 'fix the build', 1), turnError('RATE_LIMIT')])
    render(<TurnErrorNodeView {...errorProps(f)} />)
    const retry = screen.getByRole('button', { name: 'Retry' })
    expect(retry.getAttribute('title')).toBe(RETRY_HINT)
    fireEvent.click(retry)
    expect(f.setDraft).toHaveBeenCalledWith('fix the build')
    expect(f.submit).toHaveBeenCalledTimes(1)
    expect(f.setDraft.mock.invocationCallOrder[0] ?? 0).toBeLessThan(f.submit.mock.invocationCallOrder[0] ?? 0)
  })

  it('is hidden once a later turn exists', () => {
    const f = fixture([userTurn(1, 'fix the build', 1), turnError(), userTurn(4, 'next', 2)])
    render(<TurnErrorNodeView {...errorProps(f)} />)
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  })

  it('is hidden while the session runs', () => {
    const f = fixture([userTurn(1, 'fix the build', 1), turnError()], { running: true })
    render(<TurnErrorNodeView {...errorProps(f)} />)
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  })

  it.each(['ACCOUNT_SIGNED_OUT', 'ACCOUNT_SIGN_IN_REQUIRED'])('is hidden for the %s account code', (code) => {
    const f = fixture([userTurn(1, 'fix the build', 1), turnError(code)])
    render(<TurnErrorNodeView {...errorProps(f)} />)
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  })

  it('is hidden when the turn has no user message to re-send', () => {
    const f = fixture([turnError()])
    render(<TurnErrorNodeView {...errorProps(f)} />)
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  })

  it('is disabled while the composer holds a draft, so the draft is never overwritten', () => {
    const f = fixture([userTurn(1, 'fix the build', 1), turnError()], { draft: 'wip' })
    render(<TurnErrorNodeView {...errorProps(f)} />)
    const retry = screen.getByRole('button', { name: 'Retry' })
    expect(retry.hasAttribute('disabled')).toBe(true)
    expect(retry.getAttribute('title')).toBe('Send or clear the message box first')
    fireEvent.click(retry)
    expect(f.setDraft).not.toHaveBeenCalled()
    expect(f.submit).not.toHaveBeenCalled()
  })
})

describe('turn-max-tokens continue', () => {
  it('sends continue through the composer on the latest idle turn', () => {
    const f = fixture([userTurn(1, 'write a long essay', 1), turnMaxTokens()])
    render(<TurnMaxTokensNodeView {...maxTokensProps(f)} />)
    expect(screen.getByRole('status').textContent).toContain('Output token limit reached')
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(f.setDraft).toHaveBeenCalledWith('continue')
    expect(f.submit).toHaveBeenCalledTimes(1)
  })

  it('is hidden once a later turn exists', () => {
    const f = fixture([userTurn(1, 'write a long essay', 1), turnMaxTokens(), userTurn(4, 'next', 2)])
    render(<TurnMaxTokensNodeView {...maxTokensProps(f)} />)
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull()
  })

  it('is hidden while the session runs', () => {
    const f = fixture([userTurn(1, 'write a long essay', 1), turnMaxTokens()], { running: true })
    render(<TurnMaxTokensNodeView {...maxTokensProps(f)} />)
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull()
  })
})

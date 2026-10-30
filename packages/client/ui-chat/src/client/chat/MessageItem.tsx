import { memo, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { PendingSubmission } from '@deepseek-ai/dsh-api-session-controller/client'
import type { PropsRenderFactories, PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type { UserTextFacts } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { Button, JsonBlock, StateDot, TextShimmer } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatNode } from '../contract/chat-nodes.ts'
import type {
  ChatNodeOwnerProps, ChatNodeViewProps, ChatViewSlotProps, UserContentAttachment, UserContentData, UserContentInput,
} from '../contract/slots.ts'
import type { ChatSnapshot, ModelRetryNode, TurnErrorNode, UserMessageNode } from '../contract/snapshot.ts'
import type { ChatKey } from '../locale.ts'
import { CompactionItem } from './CompactionItem.tsx'
import { ContextInjectionRow } from './ContextInjectionRow.tsx'
import { MessageIconActions } from './MessageIconActions.tsx'
import { providerUsageLimitOf } from '@deepseek-ai/dsh-llm/provider-limit'
import css from './MessageItem.module.css'

const EMPTY_TEXT_FACTS: Readonly<Partial<UserTextFacts>> = {}

type UserImage = Extract<UserMessageNode['content'][number], { type: 'image' }>
type UserFile = Extract<UserMessageNode['content'][number], { type: 'file' }>
function contentParts(content: readonly unknown[]): {
  text: string
  attachments: UserContentAttachment[]
  rest: unknown[]
} {
  const texts: string[] = []
  const attachments: UserContentAttachment[] = []
  const rest: unknown[] = []
  for (const block of content) {
    const b = block as { type?: string; text?: string; attachment?: unknown }
    if (b.type === 'text' && typeof b.text === 'string') texts.push(b.text)
    else if (b.type === 'image' && b.attachment !== undefined) {
      attachments.push({ type: 'image', image: { attachment: (b as UserImage).attachment } })
    }
    else if (b.type === 'file' && b.attachment !== undefined) {
      attachments.push({ type: 'file', file: (b as UserFile).attachment })
    }
    else rest.push(block)
  }
  return { text: texts.join(''), attachments, rest }
}

function retrySeconds(milliseconds: number): number {
  return Math.max(1, Math.ceil(milliseconds / 1_000))
}

interface RetryCountdown {
  deadline: number
  seconds: number
}

const FAILURE_COPY = {
  ACCOUNT_SIGNED_OUT: 'message.failure.accountSignedOut',
  ACCOUNT_SIGN_IN_REQUIRED: 'message.failure.accountSignInRequired',
  INTERRUPTED: 'message.failure.interrupted',
  QUOTA: 'message.failure.quota',
  ACCOUNT_QUOTA: 'message.failure.quota',
  AUTH: 'message.failure.auth',
  MISSING_CREDENTIAL: 'message.failure.missingCredential',
  INVALID_CREDENTIAL: 'message.failure.invalidCredential',
  RATE_LIMIT: 'message.failure.rateLimit',
} as const satisfies Record<string, ChatKey>

/** Account codes that re-sending cannot fix. */
const NO_RETRY_CODES = new Set(['ACCOUNT_SIGNED_OUT', 'ACCOUNT_SIGN_IN_REQUIRED'])

function usageLimitOf(message: string, code: unknown): ReturnType<typeof providerUsageLimitOf> {
  return typeof code === 'string' && Object.hasOwn(FAILURE_COPY, code) ? undefined : providerUsageLimitOf(message)
}

function failureMessage(
  message: string,
  code: unknown,
  t: ChatViewSlotProps['t'],
): string {
  if (typeof code === 'string' && Object.hasOwn(FAILURE_COPY, code)) return t(FAILURE_COPY[code as keyof typeof FAILURE_COPY])
  const limit = providerUsageLimitOf(message)
  if (limit === undefined) return message
  return limit.regainDate === undefined
    ? t('message.failure.usageLimit.noDate')
    : t('message.failure.usageLimit', { date: limit.regainDate })
}

/** Text of the first user message in one Turn. */
function turnPromptText(snapshot: ChatSnapshot, turn: number): string | undefined {
  for (const key of snapshot.order) {
    const node = snapshot.nodes.get(key)
    if (node?.kind !== 'user') continue
    if ((node.location.kind === 'turn' || node.location.kind === 'step') && node.location.turn.turn === turn) {
      const { text } = contentParts((node as ChatNode<'user'>).data.content)
      return text === '' ? undefined : text
    }
  }
  return undefined
}

function ModelRetryItem({ node, active, t }: {
  node: ModelRetryNode
  active: boolean
  t: ChatViewSlotProps['t']
}) {
  // Anchor the host-scheduled delay to this browser's first render of the
  // retry node. Host event time and Date.now() may belong to different clocks.
  const deadline = useMemo(() => Date.now() + node.delayMs, [node.delayMs, node.seq])
  const scheduledSeconds = retrySeconds(node.delayMs)
  const maximum = node.mode === 'normal' ? node.maxRetries : '∞'
  const [countdown, setCountdown] = useState<RetryCountdown>(() => ({
    deadline,
    seconds: retrySeconds(deadline - Date.now()),
  }))
  const remainingSeconds = countdown.deadline === deadline
    ? countdown.seconds
    : retrySeconds(deadline - Date.now())

  useEffect(() => {
    if (!active) return
    const updateCountdown = (): number => {
      const next = retrySeconds(deadline - Date.now())
      setCountdown(current => (
        current.deadline === deadline && current.seconds === next
          ? current
          : { deadline, seconds: next }
      ))
      return next
    }
    if (updateCountdown() === 1) return
    const timer = window.setInterval(() => {
      if (updateCountdown() === 1) window.clearInterval(timer)
    }, 250)
    return () => { window.clearInterval(timer) }
  }, [active, deadline])

  const label = active
    ? t('message.retry.active')
    : node.retryState === 'cancelled'
      ? t('message.retry.cancelled')
      : node.retryState === 'started'
        ? t('message.retry.started')
        : t('message.retry.scheduled')
  const seconds = active ? remainingSeconds : scheduledSeconds

  return (
    <details className={css.retryRow} data-active={active || undefined}>
      <summary className={css.retrySummary}>
        <span className={css.retryText} role="status">
          <TextShimmer active={active}>
            {t('message.retry.status', { label, retry: node.retry, maximum, seconds })}
          </TextShimmer>
        </span>
      </summary>
      <div className={css.retryDetails}>
        <div>
          <span className={css.retryDetailLabel}>{t('message.retry.delay')}</span>
          {t('duration.milliseconds', { milliseconds: Math.round(node.delayMs) })}
        </div>
        <div>
          <span className={css.retryDetailLabel}>{t('message.retry.failure')}</span>
          {failureMessage(node.failure.message, node.failure.code, t)}
        </div>
      </div>
    </details>
  )
}

/** Turn-end button that resends through the composer. */
function TurnEndAction({ label, prompt, hint, useInput, inputActions, t }: Pick<ChatNodeViewProps<'turn-error'>, 'useInput' | 'inputActions' | 't'> & {
  label: string
  prompt: string
  hint: string
}) {
  const ready = useInput(s => s.phase === 'plain' && s.draft === '' && s.attachmentIds.length === 0)
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={!ready}
      title={ready ? hint : t('message.action.draftBusy')}
      onClick={() => {
        inputActions.setDraft(prompt)
        inputActions.submit()
      }}
    >
      {label}
    </Button>
  )
}

/** Persistent, turn-positioned feedback for a terminal failure. */
function TurnErrorItem({ node, t, action }: {
  node: TurnErrorNode
  t: ChatViewSlotProps['t']
  action?: ReactNode
}) {
  return (
    <div className={css.turnErrorRow} role="status">
      <StateDot state="error" className={css.turnErrorDot} />
      <div className={css.turnErrorCopy}>
        <span className={css.turnErrorTitle}>{node.code === 'ACCOUNT_SIGNED_OUT' || node.code === 'INTERRUPTED' ? t('message.taskStopped') : t('message.turnError')}</span>
        <span className={css.turnErrorMessage}>{failureMessage(node.message, node.code, t)}</span>
        {usageLimitOf(node.message, node.code) !== undefined && (
          <details className={css.turnErrorDetails}>
            <summary>{t('message.failure.details')}</summary>
            <pre className={css.turnErrorRaw}>{node.message}</pre>
          </details>
        )}
        {action !== undefined && <div className={css.turnEndActions}>{action}</div>}
      </div>
      {node.code !== undefined && node.code !== 'INTERRUPTED' && <code className={css.turnErrorCode}>{node.code}</code>}
    </div>
  )
}

/** Persistent, turn-positioned notice for a turn ended at the output-token cap. */
function TurnMaxTokensItem({ t, action }: {
  t: ChatViewSlotProps['t']
  action?: ReactNode
}) {
  return (
    <div className={css.turnErrorRow} role="status">
      <StateDot state="warning" className={css.turnErrorDot} />
      <div className={css.turnErrorCopy}>
        <span className={css.maxTokensTitle}>{t('message.maxTokens')}</span>
        <span className={css.turnErrorMessage}>{t('message.maxTokens.hint')}</span>
        {action !== undefined && <div className={css.turnEndActions}>{action}</div>}
      </div>
    </div>
  )
}

/**
 * A row the message-source seat decorates. A durable Chat node satisfies it;
 * pending and local-echo rows pass a source-less stand-in.
 */
interface DecoratedRow {
  readonly kind: 'user' | 'steering'
  readonly data: { readonly source: unknown }
}

/** Pending and local-echo rows carry no durable source for the seat to elect. */
const UNDECORATED_ROW: DecoratedRow = { kind: 'user', data: { source: null } }

/** Occupant used by rows that do not own the message-source seat. */
const NO_MESSAGE_SOURCE: PropsRenderSlots<'conversation.chat.user.before'>['renderSlotChain'] = () => null

/** Right-aligned bubble shared by user and steering rows. */
function UserStyleBubble({
  node, renderSlotChain, content, loadImage, renderFactorySlot, actions,
  pending = false, echo = false, batchStart = false,
  referenceLabels, skillNames, previewAttachments, facts: inputFacts = EMPTY_TEXT_FACTS, interactive = false,
}: {
  content: readonly unknown[]
  renderFactorySlot: PropsRenderFactories['renderFactorySlot']
  /** Optional IconActions (or similar) below the bubble; receives the joined text. */
  actions?: (text: string) => ReactNode
  /** Row whose durable source the message-source seat elects above this bubble. */
  node: DecoratedRow
  /** Seat renderer; rows that do not own the seat pass {@link NO_MESSAGE_SOURCE}. */
  renderSlotChain: PropsRenderSlots<'conversation.chat.user.before'>['renderSlotChain']
  /** Whether this is the Host-authoritative pre-admission steering projection. */
  pending?: boolean
  /** Whether this is a local submission echo (invisible marker; the echo renders exactly like its durable replacement). */
  echo?: boolean
  /** Whether this admitted steering row starts its claim's batch and keeps the Turn tail slot above it. */
  batchStart?: boolean
  /** Exact session mention labels associated by the adjacent recall node. */
  referenceLabels?: readonly string[]
  /** Skill names the step's `skill-invocation` injections loaded for this message. */
  skillNames?: readonly string[]
  /** Local submission-echo attachments replacing the content-derived attachment sequence. */
  previewAttachments?: readonly UserContentAttachment[]
  /** Inputs used by text transforms, separate from row and rendering props. */
  facts?: Readonly<Partial<UserTextFacts>>
} & Pick<ChatNodeOwnerProps, 'loadImage'> & Pick<UserContentInput, 'interactive'>): ReactNode {
  const parts = useMemo(() => contentParts(content), [content])
  const prepared = useMemo<UserContentData>(() => ({
    text: parts.text,
    attachments: previewAttachments ?? parts.attachments,
    extraBlocks: parts.rest,
    ...(referenceLabels === undefined ? {} : { referenceLabels }),
  }), [parts, previewAttachments, referenceLabels])
  const facts = useMemo<Readonly<Partial<UserTextFacts>>>(() => ({
    ...inputFacts,
    ...(referenceLabels === undefined ? {} : { sessionLabels: referenceLabels }),
    ...(skillNames === undefined ? {} : { skillNames }),
  }), [inputFacts, referenceLabels, skillNames])
  return (
    <div
      className={css.userRow}
      data-pending-steering={pending || undefined}
      data-submission-echo={echo || undefined}
      data-chat-steering-batch={batchStart ? 'start' : undefined}
    >
      {renderSlotChain('conversation.chat.user.before', { source: node.data.source, kind: node.kind }, { fallback: null })}
      {renderFactorySlot('conversation.chat.user.content', {
        content: prepared,
        loadImage,
        facts,
        interactive,
      })}
      {actions?.(prepared.text)}
    </div>
  )
}

/**
 * Render one Host-authoritative pending steering item with the same visual
 * language as its eventual durable transcript node.
 * @param props - pending content, authorized image loader, and Factory/locale seats.
 * @returns the pending steering bubble.
 */
export function PendingSteeringBubble({ content, loadImage, renderFactorySlot, t }: {
  content: readonly unknown[]
  renderFactorySlot: PropsRenderFactories['renderFactorySlot']
  t: ChatViewSlotProps['t']
} & Pick<ChatNodeOwnerProps, 'loadImage'>): ReactNode {
  return (
    <UserStyleBubble
      node={UNDECORATED_ROW}
      renderSlotChain={NO_MESSAGE_SOURCE}
      content={content}
      renderFactorySlot={renderFactorySlot}
      loadImage={loadImage}
      pending
      actions={text => (
        <MessageIconActions
          text={text}
          clock="start"
          className={css.actions}
          t={t}
        />
      )}
    />
  )
}

/**
 * Render one local transcript or steering submission echo with the same
 * visual language and surface marker as the Host occurrence that replaces
 * it: draft text plus object-URL previews, visible from the submit click
 * until the durable `user/message` or steering occurrence renders.
 * @param props - the pending submission, authorized image loader, and render seats.
 * @returns the echoed user bubble.
 */
export function PendingSubmissionBubble({ submission, loadImage, renderFactorySlot, t }: {
  submission: PendingSubmission
  renderFactorySlot: PropsRenderFactories['renderFactorySlot']
  t: ChatViewSlotProps['t']
} & Pick<ChatNodeOwnerProps, 'loadImage'>): ReactNode {
  const content = useMemo(
    () => (submission.text === '' ? [] : [{ type: 'text', text: submission.text }]),
    [submission.text],
  )
  const previewAttachments = useMemo<readonly UserContentAttachment[]>(
    () => submission.attachments.map(attachment => attachment.type === 'image'
      ? {
        type: 'image',
        image: {
          preview: {
            url: attachment.value.previewUrl,
            ...(attachment.value.name === undefined ? {} : { name: attachment.value.name }),
            ...(attachment.value.width === undefined ? {} : { width: attachment.value.width }),
            ...(attachment.value.height === undefined ? {} : { height: attachment.value.height }),
          },
        },
      }
      : { type: 'file', file: attachment.value }),
    [submission.attachments],
  )
  return (
    <UserStyleBubble
      node={UNDECORATED_ROW}
      renderSlotChain={NO_MESSAGE_SOURCE}
      content={content}
      previewAttachments={previewAttachments}
      renderFactorySlot={renderFactorySlot}
      loadImage={loadImage}
      pending={submission.placement === 'steering'}
      echo
      actions={text => (
        <MessageIconActions
          text={text}
          time={submission.time}
          clock="start"
          className={css.actions}
          t={t}
        />
      )}
    />
  )
}

/**
 * Official user and admitted-steering keyed Chat renderer.
 *
 * Renders the durable-message chain seat directly above the bubble. The seat is
 * declared by the `user` registration alone, so a steering row renders the same
 * bubble without asking for it.
 */
export const UserMessageNodeView = memo(function UserMessageNodeView({
  node, renderFactorySlot, loadImage, renderSlotChain, t,
}: ChatNodeViewProps<'user' | 'steering'> & {
  /** Bound by the `user` keyed registration, the only entry that declares the seat. */
  renderSlotChain: PropsRenderSlots<'conversation.chat.user.before'>['renderSlotChain']
}) {
  const data = node.data
  return (
    <UserStyleBubble
      node={node}
      renderSlotChain={renderSlotChain}
      content={data.content}
      interactive
      renderFactorySlot={renderFactorySlot}
      loadImage={loadImage}
      batchStart={node.kind === 'steering' && node.data.batchStart === true}
      {...data.referenceLabels === undefined ? {} : { referenceLabels: data.referenceLabels }}
      {...data.skillNames === undefined ? {} : { skillNames: data.skillNames }}
      actions={text => (
        <MessageIconActions
          text={text}
          time={data.time}
          clock="start"
          className={css.actions}
          t={t}
        />
      )}
    />
  )
})

/** Injected-context keyed Chat renderer. */
export const ContextMessageNodeView = memo(function ContextMessageNodeView({ node, t }: ChatNodeViewProps<'context'>) {
  const data = node.data
  return (
    <ContextInjectionRow
      content={data.content}
      source={data.source}
      producer={data.producer}
      form={data.form}
      t={t}
    />
  )
})

/** Automatic compaction keyed Chat renderer. */
export const CompactionNodeView = memo(function CompactionNodeView({ node, t }: ChatNodeViewProps<'compaction'>) {
  return <CompactionItem node={node.data} t={t} />
})

/** Correlated retry-chain keyed Chat renderer. */
export const RetryNodeView = memo(function RetryNodeView({ node, t }: ChatNodeViewProps<'model-retry'>) {
  const data = node.data
  return <ModelRetryItem node={data.current} active={data.current.retryState === 'scheduled'} t={t} />
})

/** Terminal turn-error keyed Chat renderer. */
export const TurnErrorNodeView = memo(function TurnErrorNodeView({ node, useChat, useSession, useInput, inputActions, t }: ChatNodeViewProps<'turn-error'>) {
  const data = node.data
  const latest = useChat(s => s.timeline.turnOrder.at(-1)) === data.turn
  const running = useSession(s => s.running)
  const offer = latest && !running && !NO_RETRY_CODES.has(data.code ?? '')
  const prompt = useChat(s => offer ? turnPromptText(s, data.turn) : undefined)
  return (
    <TurnErrorItem
      node={data}
      t={t}
      action={prompt === undefined ? undefined : (
        <TurnEndAction
          label={t('retry')}
          prompt={prompt}
          hint={t('message.action.retryHint')}
          useInput={useInput}
          inputActions={inputActions}
          t={t}
        />
      )}
    />
  )
})

/** Max-tokens turn-end notice keyed Chat renderer. */
export const TurnMaxTokensNodeView = memo(function TurnMaxTokensNodeView({ node, useChat, useSession, useInput, inputActions, t }: ChatNodeViewProps<'turn-max-tokens'>) {
  const data = node.data
  const latest = useChat(s => s.timeline.turnOrder.at(-1)) === data.turn
  const running = useSession(s => s.running)
  const offer = latest && !running
  return (
    <TurnMaxTokensItem
      t={t}
      action={!offer ? undefined : (
        <TurnEndAction
          label={t('message.action.continue')}
          prompt={t('message.action.continuePrompt')}
          hint={t('message.action.continue')}
          useInput={useInput}
          inputActions={inputActions}
          t={t}
        />
      )}
    />
  )
})

/** Explicit unknown-surface keyed Chat renderer. */
export const UnknownNodeView = memo(function UnknownNodeView({ node, t }: ChatNodeViewProps<'unknown'>) {
  const data = node.data
  return (
    <div className={css.contextRow}>
      <JsonBlock
        label={t('message.unknownSurface', { type: data.type })}
        payload={data.data}
        truncatedLabel={total => t('json.truncated', { total })}
      />
    </div>
  )
})

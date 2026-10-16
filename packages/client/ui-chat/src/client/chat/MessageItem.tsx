import { Fragment, memo, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { PendingSubmission } from '@deepseek-ai/dsh-api-session-controller/client'
import type { MessageImageSource } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { Button, fileExtension, FileTypeIcon, fileSizeText, JsonBlock, projectUserText, StateDot, TextShimmer } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatNode } from '../contract/chat-nodes.ts'
import type { ChatNodeOwnerProps, ChatNodeViewProps, ChatViewSlotProps } from '../contract/slots.ts'
import type { ChatSnapshot, ModelRetryNode, TurnErrorNode, UserMessageNode } from '../contract/snapshot.ts'
import type { ChatKey } from '../locale.ts'
import { CompactionItem } from './CompactionItem.tsx'
import { ContextInjectionRow } from './ContextInjectionRow.tsx'
import { MessageIconActions } from './MessageIconActions.tsx'
import { providerUsageLimitOf } from '@deepseek-ai/dsh-llm/provider-limit'
import css from './MessageItem.module.css'

type UserImage = Extract<UserMessageNode['content'][number], { type: 'image' }>
type UserFile = Extract<UserMessageNode['content'][number], { type: 'file' }>
type PresentedAttachment =
  | { readonly type: 'image'; readonly image: MessageImageSource }
  | { readonly type: 'file'; readonly file: UserFile['attachment'] }

function contentParts(content: readonly unknown[]): {
  text: string
  attachments: PresentedAttachment[]
  rest: unknown[]
} {
  const texts: string[] = []
  const attachments: PresentedAttachment[] = []
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
        <span className={css.turnErrorTitle}>{node.code === 'ACCOUNT_SIGNED_OUT' ? t('message.accountStopped') : t('message.turnError')}</span>
        <span className={css.turnErrorMessage}>{failureMessage(node.message, node.code, t)}</span>
        {usageLimitOf(node.message, node.code) !== undefined && (
          <details className={css.turnErrorDetails}>
            <summary>{t('message.failure.details')}</summary>
            <pre className={css.turnErrorRaw}>{node.message}</pre>
          </details>
        )}
        {action !== undefined && <div className={css.turnEndActions}>{action}</div>}
      </div>
      {node.code !== undefined && <code className={css.turnErrorCode}>{node.code}</code>}
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

/** Right-aligned bubble shared by user and steering rows. */
function UserStyleBubble({
  content, renderMessageImages, actions, pending = false, echo = false, referenceLabels = [], skillNames = [],
  previewAttachments, references, t,
}: {
  content: readonly unknown[]
  renderMessageImages: ChatNodeOwnerProps['renderMessageImages']
  /** Optional IconActions (or similar) below the bubble; receives the joined text. */
  actions?: (text: string) => ReactNode
  /** Whether this is the Host-authoritative pre-admission steering projection. */
  pending?: boolean
  /** Whether this is a local submission echo (invisible marker; the echo renders exactly like its durable replacement). */
  echo?: boolean
  /** Exact session mention labels associated by the adjacent recall node. */
  referenceLabels?: readonly string[]
  /** Skill names the step's `skill-invocation` injections loaded for this message. */
  skillNames?: readonly string[]
  /** Local submission-echo attachments replacing the content-derived attachment sequence. */
  previewAttachments?: readonly PresentedAttachment[]
  references?: Pick<ChatNodeOwnerProps, 'openFile' | 'openSkill'>
  t: ChatViewSlotProps['t']
}): ReactNode {
  const { text, attachments: contentAttachments, rest } = contentParts(content)
  const attachments = previewAttachments ?? contentAttachments
  const compactImages = attachments.length > 1
  const truncated = (total: number): string => t('json.truncated', { total })
  const showBubble = text !== '' || rest.length > 0
  return (
    <div
      className={css.userRow}
      data-pending-steering={pending || undefined}
      data-submission-echo={echo || undefined}
    >
      <div className={css.userStack}>
        {attachments.length > 0 && (
          <div className={css.attachmentRow} data-message-attachments>
            {attachments.map((attachment, index) => attachment.type === 'image'
              ? (
                <Fragment key={`image:${index}`}>
                  {renderMessageImages({
                    images: [attachment.image],
                    align: 'end',
                    compact: compactImages,
                  })}
                </Fragment>
              )
              : (
                <span key={`file:${index}`} className={css.fileCard} title={attachment.file.name}>
                  <FileTypeIcon path={attachment.file.name} className={css.fileIcon} />
                  <span className={css.fileContent}>
                    <span className={css.fileName}>{attachment.file.name}</span>
                    <span className={css.fileMeta}>
                      {[fileExtension(attachment.file.name).toUpperCase().slice(0, 8), fileSizeText(attachment.file.bytes)]
                        .filter(Boolean).join(' ')}
                    </span>
                  </span>
                </span>
              ))}
          </div>
        )}
        {showBubble && <div className={css.bubble}>
          {projectUserText(text, referenceLabels, skillNames, 'skill', references)}
          {rest.map((block, i) => <JsonBlock key={i} label={t('message.extraBlock')} payload={block} truncatedLabel={truncated} />)}
        </div>}
        {referenceLabels.length > 0 && (
          <div className={css.referenceSummary}>
            {t('message.referenceSummary', { labels: referenceLabels.join(t('message.referenceSeparator')) })}
          </div>
        )}
      </div>
      {actions?.(text)}
    </div>
  )
}

/**
 * Render one Host-authoritative pending steering item with the same visual
 * language as its eventual durable transcript node.
 * @param props - Pending message content and conversation translator.
 * @returns the pending steering bubble.
 */
export function PendingSteeringBubble({ content, renderMessageImages, t }: {
  content: readonly unknown[]
  renderMessageImages: ChatNodeOwnerProps['renderMessageImages']
  t: ChatViewSlotProps['t']
}): ReactNode {
  return (
    <UserStyleBubble
      content={content}
      renderMessageImages={renderMessageImages}
      pending
      t={t}
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
 * @param props - the session snapshot's pending submission and render seats.
 * @returns the echoed user bubble.
 */
export function PendingSubmissionBubble({ submission, renderMessageImages, t }: {
  submission: PendingSubmission
  renderMessageImages: ChatNodeOwnerProps['renderMessageImages']
  t: ChatViewSlotProps['t']
}): ReactNode {
  const content = useMemo(
    () => (submission.text === '' ? [] : [{ type: 'text', text: submission.text }]),
    [submission.text],
  )
  const previewAttachments = useMemo<readonly PresentedAttachment[]>(
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
      content={content}
      previewAttachments={previewAttachments}
      renderMessageImages={renderMessageImages}
      pending={submission.placement === 'steering'}
      echo
      t={t}
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

/** User and admitted-steering keyed Chat renderer. */
export const UserMessageNodeView = memo(function UserMessageNodeView({
  node, renderMessageImages, openFile, openSkill, t,
}: ChatNodeViewProps<'user' | 'steering'>) {
  const data = node.data
  return (
    <UserStyleBubble
      content={data.content}
      references={{ openFile, openSkill }}
      renderMessageImages={renderMessageImages}
      {...data.referenceLabels === undefined ? {} : { referenceLabels: data.referenceLabels }}
      {...data.skillNames === undefined ? {} : { skillNames: data.skillNames }}
      t={t}
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

/**
 * The "Sign in with ChatGPT" card: one provider route's authorization flow.
 *
 * The Host owns the conversation with the human and streams every notice for
 * this attempt as it happens; this card renders whatever arrives and returns
 * typed answers. It holds no protocol knowledge — an OAuth browser hand-off, a
 * device code, and a pasted key all render through the same two shapes, because
 * the Host reports them in one vocabulary.
 *
 * The attempt's notices arrive on this card's own stream, so the card needs no
 * correlation: a second tab's sign-in can neither appear here nor be answered
 * from here. An answer is applied only after the Host accepts it, so a refusal
 * leaves the question on screen rather than dropping it silently.
 *
 * @module dsh-client-ui-settings-models/client/SignInCard
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { AuthorizationEntryView, AuthorizationNotice } from '@deepseek-ai/dsh-api-settings-controller/types'
import type { AuthorizationOperations } from './authorization-operations.ts'
import type { en } from './locales.ts'
import styles from './ModelsSection.module.css'

/** One question the card is waiting on, with the capability that asked it. */
interface OpenQuestion {
  readonly attempt: string
  readonly prompt: string
  readonly kind: NonNullable<AuthorizationNotice['kind']>
  readonly message: string
  readonly placeholder?: string
  readonly options?: readonly { readonly id: string; readonly label: string }[]
}

/** How the card is doing right now. */
type SignInPhase =
  | { readonly status: 'idle' }
  | { readonly status: 'running'; readonly notices: readonly AuthorizationNotice[] }
  | { readonly status: 'failed'; readonly message: string }
  | { readonly status: 'cancelled' }

/** Props of {@link SignInCard}. */
export interface SignInCardProps {
  /** Provider route id, used as the display name. */
  provider: string
  /** Display name for the card title. */
  displayName: string
  /** The Host authorization calls. */
  operations: AuthorizationOperations
  /** Localizer for the card's own labels. */
  t: (key: keyof typeof en, params?: Record<string, string>) => string
  /** Reports that a credential was stored, so the page can refresh its rows. */
  onSignedIn?: () => void
}

/**
 * Render the sign-in card for one provider route.
 * @param props - the provider, its Host operations, and the localizer.
 * @returns the sign-in card, or nothing when this route offers no flow.
 */
export function SignInCard(props: SignInCardProps): ReactNode {
  const { provider, displayName, operations, t, onSignedIn } = props
  const [entry, setEntry] = useState<AuthorizationEntryView | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [phase, setPhase] = useState<SignInPhase>({ status: 'idle' })
  const [question, setQuestion] = useState<OpenQuestion | null>(null)
  const [answerFailure, setAnswerFailure] = useState<string | undefined>(undefined)
  const [draft, setDraft] = useState('')
  const abortRef = useRef<AbortController | null>(null)
  const mountedRef = useRef(true)

  // The flow this route owns, if the deployment registered one for it.
  useEffect(() => {
    let active = true
    void operations.list().then((flows) => {
      if (!active) return
      setEntry(flows.find(flow => flow.key.endsWith(`/${provider}`)) ?? null)
      setLoaded(true)
    })
    return () => { active = false }
  }, [operations, provider])

  // An unmounting card withdraws its attempt rather than leaving it parked.
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      abortRef.current?.abort()
    }
  }, [])

  const start = useCallback(async (method: string) => {
    // Captured so the async body narrows once: the card only offers this while
    // a flow is known, and a sign-in cannot outlive the entry it started from.
    if (entry === null) return
    const controller = new AbortController()
    abortRef.current = controller
    setQuestion(null)
    setAnswerFailure(undefined)
    setDraft('')
    setPhase({ status: 'running', notices: [] })
    const outcome = await operations.begin(entry.key, method, (item) => {
      if (!mountedRef.current) return
      if (item.type === 'start') return
      if (item.type === 'end') {
        // The attempt is over, so nothing it asked is still answerable. This is
        // the only place a question is retired without an answer, which is what
        // keeps a refused answer on screen while the attempt is still running.
        setQuestion(null)
        return
      }
      if (item.prompt === undefined) {
        setPhase(current => current.status === 'running'
          ? { ...current, notices: [...current.notices, item] }
          : current)
        return
      }
      setQuestion({
        attempt: item.attempt,
        prompt: item.prompt,
        kind: item.kind ?? 'text',
        message: item.message,
        ...item.placeholder === undefined ? {} : { placeholder: item.placeholder },
        ...item.options === undefined ? {} : { options: item.options },
      })
    }, controller.signal)
    abortRef.current = null
    if (!mountedRef.current) return
    setQuestion(null)
    setAnswerFailure(undefined)
    if (outcome.kind === 'authorized') {
      setPhase({ status: 'idle' })
      onSignedIn?.()
      return
    }
    setPhase(outcome.kind === 'cancelled' ? { status: 'cancelled' } : { status: 'failed', message: outcome.message })
  }, [entry, operations, onSignedIn])

  const answer = useCallback(async (value: string) => {
    if (question === null) return
    const outcome = await operations.answer(question.attempt, question.prompt, value)
    if (!mountedRef.current) return
    if (outcome.kind === 'refused') {
      // The Host rejected the answer, so the question is still open: keep it on
      // screen with the reason rather than clearing it and stranding the flow.
      setAnswerFailure(outcome.message)
      return
    }
    setAnswerFailure(undefined)
    setQuestion(null)
    setDraft('')
  }, [operations, question])

  if (!loaded) return null
  // A route with no registered flow authenticates through its API key, which
  // the surrounding editor already offers.
  if (entry === null) return null

  const running = phase.status === 'running'
  const notices = phase.status === 'running' ? phase.notices : []

  return (
    <div className={styles['signInCard']}>
      <div className={styles['signInHeader']}>
        <span className={styles['signInTitle']}>{t('signInTitle', { provider: displayName })}</span>
        <span className={entry.configured ? styles['signInStateOn'] : styles['signInStateOff']}>
          {entry.configured ? t('signedIn') : t('signedOut')}
        </span>
      </div>
      <p className={styles['signInHint']}>{t('signInDescription')}</p>

      {notices.map((notice, index) => (
        <div key={`${String(index)}:${notice.message}:${notice.code ?? ''}`} className={styles['signInNotice']}>
          <span>{notice.message}</span>
          {notice.code === undefined ? null : <code className={styles['signInCode']}>{notice.code}</code>}
          {notice.url === undefined ? null : (
            <a className={styles['signInLink']} href={notice.url} target="_blank" rel="noreferrer">
              {t('signInOpenPage')}
            </a>
          )}
        </div>
      ))}

      {question === null ? null : (
        <div className={styles['signInQuestion']}>
          <label className={styles['signInQuestionLabel']} htmlFor="sign-in-answer">{question.message}</label>
          {question.kind === 'select' ? (
            <div className={styles['signInOptions']}>
              {(question.options ?? []).map(option => (
                <button
                  key={option.id}
                  type="button"
                  className={styles['secondaryButton']}
                  onClick={() => { void answer(option.id) }}
                >
                  {option.label}
                </button>
              ))}
            </div>
          ) : (
            <div className={styles['signInAnswerRow']}>
              <input
                id="sign-in-answer"
                className={styles['input']}
                type={question.kind === 'secret' ? 'password' : 'text'}
                value={draft}
                placeholder={question.placeholder ?? ''}
                onChange={(event) => { setDraft(event.target.value) }}
                onKeyDown={(event) => { if (event.key === 'Enter' && draft.length > 0) void answer(draft) }}
              />
              <button
                type="button"
                className={styles['primaryButton']}
                disabled={draft.length === 0}
                onClick={() => { void answer(draft) }}
              >
                {t('signInSubmit')}
              </button>
            </div>
          )}
          {answerFailure === undefined
            ? null
            : <p className={styles['signInError']}>{t('signInAnswerFailed', { message: answerFailure })}</p>}
        </div>
      )}

      {phase.status === 'failed' ? (
        <p className={styles['signInError']}>{t('signInFailed', { message: phase.message })}</p>
      ) : null}
      {phase.status === 'cancelled' ? <p className={styles['signInHint']}>{t('signInCancelled')}</p> : null}

      <div className={styles['signInActions']}>
        {running ? (
          <button
            type="button"
            className={styles['secondaryButton']}
            onClick={() => { abortRef.current?.abort() }}
          >
            {t('signInCancel')}
          </button>
        ) : (
          <button
            type="button"
            className={styles['primaryButton']}
            onClick={() => { void start(entry.methods[0]?.id ?? '') }}
          >
            {phase.status === 'failed' || phase.status === 'cancelled' ? t('signInRetry') : t('signIn')}
          </button>
        )}
        {running ? <span className={styles['signInHint']}>{t('signingIn')}</span> : null}
      </div>
    </div>
  )
}

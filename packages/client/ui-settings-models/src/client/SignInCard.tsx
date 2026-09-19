/**
 * The "Sign in with ChatGPT" card: one provider route's authorization flow.
 *
 * The Host owns the conversation with the human and pushes every notice for
 * this attempt as it happens; this card renders whatever arrives and returns
 * typed answers through the answering call. It holds no protocol knowledge —
 * an OAuth browser hand-off, a device code, and a pasted key all render through
 * the same two shapes, because the Host reports them in one vocabulary.
 *
 * A question is answered by a second call rather than a reply on the first,
 * which is why an attempt is tracked by the id the Host minted: the card matches
 * arriving notices against the attempt it started, so a second tab's sign-in
 * never writes into this card.
 *
 * @module dsh-client-ui-settings-models/client/SignInCard
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { AuthorizationEntryView } from '@deepseek-ai/dsh-api-settings-controller/types'
import type { AuthorizationNoticeEvent } from '@deepseek-ai/dsh-authorization/types'
import type { AuthorizationOperations } from './authorization-operations.ts'
import type { en } from './locales.ts'
import styles from './ModelsSection.module.css'

/** One question the card is waiting on, with the attempt that asked it. */
interface OpenQuestion {
  readonly attempt: string
  readonly prompt: string
  readonly kind: NonNullable<AuthorizationNoticeEvent['kind']>
  readonly message: string
  readonly placeholder?: string
  readonly options?: readonly { readonly id: string; readonly label: string }[]
}

/** How the card is doing right now. */
type SignInPhase =
  | { readonly status: 'idle' }
  | { readonly status: 'running'; readonly attempt: string; readonly notices: readonly AuthorizationNoticeEvent[] }
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
  const [draft, setDraft] = useState('')
  const attemptRef = useRef<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  // The notice listener is registered once, so it reads the live phase through
  // a ref rather than closing over a stale render's value.
  const phaseRef = useRef<SignInPhase>({ status: 'idle' })
  phaseRef.current = phase

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

  // Notices arrive while `begin` is pending. The attempt id is minted by the
  // Host and first seen here, so this is where the card learns which attempt is
  // its own; everything else — another tab's sign-in — is ignored.
  useEffect(() => operations.onNotice((notice) => {
    if (attemptRef.current === null) {
      if (phaseRef.current.status !== 'running') return
      attemptRef.current = notice.attempt
    }
    if (notice.attempt !== attemptRef.current) return
    if (notice.prompt === undefined) {
      setPhase(current => current.status === 'running'
        ? { ...current, notices: [...current.notices, notice] }
        : current)
      return
    }
    setQuestion({
      attempt: notice.attempt,
      prompt: notice.prompt,
      kind: notice.kind ?? 'text',
      message: notice.message,
      ...notice.placeholder === undefined ? {} : { placeholder: notice.placeholder },
      ...notice.options === undefined ? {} : { options: notice.options },
    })
  }), [operations])

  // An unmounting card withdraws its attempt rather than leaving it parked.
  useEffect(() => () => { abortRef.current?.abort() }, [])

  const start = useCallback(async (method: string) => {
    // Captured so the async body narrows once: the card only offers this while
    // a flow is known, and a sign-in cannot outlive the entry it started from.
    if (entry === null) return
    const key = entry.key
    const controller = new AbortController()
    abortRef.current = controller
    // Cleared so the first notice of this attempt adopts the card, rather than
    // a previous attempt's id being matched against it.
    attemptRef.current = null
    setQuestion(null)
    setDraft('')
    setPhase({ status: 'running', attempt: '', notices: [] })
    const outcome = await operations.begin(key, method, controller.signal)
    attemptRef.current = null
    abortRef.current = null
    setQuestion(null)
    if (outcome.kind === 'authorized') {
      setPhase({ status: 'idle' })
      onSignedIn?.()
      return
    }
    setPhase(outcome.kind === 'cancelled' ? { status: 'cancelled' } : { status: 'failed', message: outcome.message })
  }, [entry, operations, onSignedIn])

  const answer = useCallback((value: string) => {
    if (question === null) return
    void operations.answer(question.attempt, question.prompt, value)
    setQuestion(null)
    setDraft('')
  }, [operations, question])

  if (!loaded) return null
  if (entry === null) {
    // A route with no registered flow authenticates through its API key, which
    // the surrounding editor already offers.
    return null
  }

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

      {notices.map(notice => (
        <div key={`${notice.attempt}:${notice.message}:${notice.code ?? ''}`} className={styles['signInNotice']}>
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
                  onClick={() => { answer(option.id) }}
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
                onKeyDown={(event) => { if (event.key === 'Enter' && draft.length > 0) answer(draft) }}
              />
              <button
                type="button"
                className={styles['primaryButton']}
                disabled={draft.length === 0}
                onClick={() => { answer(draft) }}
              >
                {t('signInSubmit')}
              </button>
            </div>
          )}
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

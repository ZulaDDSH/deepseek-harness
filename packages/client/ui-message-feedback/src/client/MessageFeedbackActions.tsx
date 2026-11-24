/**
 * Per-message feedback controls: the Like/Dislike pair inside the assistant
 * message's IconActions row, between copy and branch. Either rating opens the
 * Session's feedback dialog, whose submission records that judgment with its
 * category and text. Clicking the recorded rating retracts it. A recorded rating
 * shows the filled glyph so the signal survives a pointer leaving the row.
 * @module @deepseek-ai/dsh-client-ui-message-feedback/client/MessageFeedbackActions
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Button, IconDislikeFillRegular, IconDislikeOutlineRegular, IconLikeFillRegular, IconLikeOutlineRegular, Modal, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { MessageFeedbackRating } from '@deepseek-ai/dsh-message-feedback/types'
import type { MessageFeedbackActionFailure } from './controller.ts'
import { exportMode } from './dialog.ts'
import type { MessageFeedbackActionProps } from './slots.ts'
import css from './MessageFeedbackActions.module.css'

/**
 * One message's feedback controls, rendered only while the current Peer may
 * record message feedback in this Session.
 * @param props - the owner's message identity, the injected verbs, the
 * shared feedback hook, and the Session access Hook.
 * @returns the rating buttons with any failure notice beside them, or nothing without access.
 */
export function MessageFeedbackActions(props: MessageFeedbackActionProps) {
  return props.useAccess('messageFeedback/put') ? <FeedbackRatingButtons {...props} /> : null
}

function FeedbackRatingButtons({
  messageId, ensure, current, retract, loadSharing, openDialog, useFeedback, useDialog, t,
}: MessageFeedbackActionProps) {
  const item = useFeedback(view => view.items.get(messageId))
  const loadFailed = useFeedback(view => view.status === 'error')
  const rating = item?.rating
  const [pending, setPending] = useState(false)
  // A rating or load failure surfaces beside the rating buttons.
  const [failure, setFailure] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<MessageFeedbackRating | null>(null)
  const [withdrawLocal, setWithdrawLocal] = useState(false)
  const sharing = useDialog(state => state.sharing)
  const mode = exportMode(sharing, withdrawLocal)
  // The controls mount for every settled message in the transcript, so the
  // Session's feedback is read once on first hover/focus rather than on mount.
  const seeded = useRef(false)
  const seed = useCallback(() => {
    if (seeded.current) return
    seeded.current = true
    void ensure()
  }, [ensure])

  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])

  const errorCopy = useCallback((result: MessageFeedbackActionFailure) => {
    return result.error.code === 'version-conflict' ? t('error.conflict') : t('error.generic')
  }, [t])

  // A recorded rating retracts on click; either unrecorded rating opens the
  // dialog and records only after submission. The decision waits for the
  // seeding read, so a click on a cold row still sees the stored judgment.
  const choose = useCallback((nextRating: MessageFeedbackRating) => {
    setPending(true)
    setFailure(null)
    void ensure().then((loaded) => {
      if (!alive.current) return
      if (!loaded.ok || current(messageId)?.rating !== nextRating) {
        setPending(false)
        openDialog(messageId, nextRating)
        return
      }
      setPending(false)
      setWithdrawLocal(false)
      setConfirming(nextRating)
      void loadSharing()
    })
  }, [current, ensure, loadSharing, messageId, openDialog])

  const withdraw = useCallback(() => {
    const target = confirming
    setConfirming(null)
    if (target === null) return
    setPending(true)
    const local = withdrawLocal && mode !== 'off'
    void (local ? retract(messageId, target, true) : retract(messageId, target)).then((result) => {
      if (!alive.current) return
      setPending(false)
      if (!result.ok) setFailure(errorCopy(result))
    })
  }, [confirming, errorCopy, messageId, mode, retract, withdrawLocal])
  const cancelWithdraw = useCallback(() => { setConfirming(null) }, [])

  const onLike = useCallback(() => { choose('positive') }, [choose])
  const onDislike = useCallback(() => { choose('negative') }, [choose])

  const likeLabel = rating === 'positive' ? t('action.likeActive') : t('action.like')
  const dislikeLabel = rating === 'negative' ? t('action.dislikeActive') : t('action.dislike')

  return (
    <>
      <Tooltip label={likeLabel} side="bottom">
        <button
          type="button"
          className={css.action}
          aria-label={likeLabel}
          aria-pressed={rating === 'positive'}
          data-active={rating === 'positive' || undefined}
          disabled={pending}
          onFocus={seed}
          onPointerEnter={seed}
          onClick={onLike}
        >
          {rating === 'positive' ? <IconLikeFillRegular /> : <IconLikeOutlineRegular />}
        </button>
      </Tooltip>
      <Tooltip label={dislikeLabel} side="bottom">
        <button
          type="button"
          className={css.action}
          aria-label={dislikeLabel}
          aria-pressed={rating === 'negative'}
          data-active={rating === 'negative' || undefined}
          disabled={pending}
          onFocus={seed}
          onPointerEnter={seed}
          onClick={onDislike}
        >
          {rating === 'negative' ? <IconDislikeFillRegular /> : <IconDislikeOutlineRegular />}
        </button>
      </Tooltip>
      <Modal
        open={confirming !== null}
        title={t('withdraw.title')}
        closeLabel={t('close')}
        onClose={cancelWithdraw}
        footer={(
          <>
            <Button onClick={cancelWithdraw}>{t('withdraw.cancel')}</Button>
            <Button variant="primary" onClick={withdraw}>{t('withdraw.confirm')}</Button>
          </>
        )}
      >
        <p role="note">
          {mode === 'off' && t('withdraw.body.off')}
          {mode === 'local' && t('withdraw.body.local')}
          {mode === 'to' && t('withdraw.body.to', { destination: sharing?.destination ?? '' })}
          {mode === 'generic' && t('withdraw.body')}
        </p>
        {mode !== 'off' && (
          <label>
            <input
              type="checkbox"
              checked={withdrawLocal}
              onChange={(event) => { setWithdrawLocal(event.target.checked) }}
            />
            {t('withdraw.localOnly')}
          </label>
        )}
      </Modal>
      {failure === null && loadFailed && (
        <span className={css.failure} role="status">{t('error.load')}</span>
      )}
      {failure !== null && <span className={css.failure} role="status">{failure}</span>}
    </>
  )
}

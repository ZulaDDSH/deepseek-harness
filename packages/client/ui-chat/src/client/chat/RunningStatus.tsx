/** Running Turn clock isolated from the transcript's render cycle. */
import { memo, useEffect, useMemo, useState } from 'react'
import { TextShimmer } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import { INACTIVITY_HINT_MS, liveActivity } from './live-activity.ts'
import { activityText, RunningActivity } from './RunningActivity.tsx'
import { formatLiveRunDuration, LIVE_RUN_CLOCK_INTERVAL_MS } from './message-chrome.ts'
import { RunningWhaleTail } from './RunningWhaleTail.tsx'
import a11yCss from './accessibility.module.css'
import css from './ChatView.module.css'

interface RunningStatusProps {
  readonly startTime: number | undefined
  readonly step?: number | undefined
  readonly task?: string | undefined
  readonly useChat: ChatViewSlotProps['useChat']
  readonly awaitingUser?: boolean
  readonly onStop: () => void
  readonly t: ChatViewSlotProps['t']
}

function useChangedAt(key: unknown): number | undefined {
  const [seen, setSeen] = useState<{ readonly key: unknown; readonly at: number } | undefined>()
  useEffect(() => { setSeen({ key, at: Date.now() }) }, [key])
  return seen !== undefined && Object.is(seen.key, key) ? seen.at : undefined
}

/**
 * Name the in-flight operation with the Turn's elapsed time and step, the active task, and a Stop hint after a silent stretch.
 * @param props - Current Turn start time, open step number, Chat selector, pending-interaction flag, Stop action, and localized copy.
 * @returns the blue running indicator; mount only while the Session is running.
 */
export const RunningStatus = memo(function RunningStatus({
  startTime, step, task, useChat, awaitingUser = false, onStop, t,
}: RunningStatusProps) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (startTime === undefined) return
    setNow(Date.now())
    const timer = setInterval(() => { setNow(Date.now()) }, LIVE_RUN_CLOCK_INTERVAL_MS)
    return () => { clearInterval(timer) }
  }, [startTime])
  const elapsed = startTime === undefined ? undefined : formatLiveRunDuration(Math.max(1000, now - startTime), t)
  const legacy = useChat(snapshot => snapshot.legacy)
  const activity = useMemo(() => liveActivity(legacy), [legacy])
  const generationSince = useChangedAt(activity.kind === 'generating' ? activity.key : undefined) ?? now
  const since = activity.kind === 'idle' ? undefined : activity.kind === 'generating' ? generationSince : activity.since
  const snapshotChangedAt = useChangedAt(legacy) ?? now
  const interactionChangedAt = useChangedAt(awaitingUser) ?? now
  const quiet = now - Math.max(snapshotChangedAt, interactionChangedAt)
  const operation = startTime === undefined || since === undefined ? undefined
    : activityText(activity, formatLiveRunDuration(Math.max(0, now - since), t), t)
  // The concrete operation leads; the generic Working line covers gaps between operations.
  const label = operation !== undefined && elapsed !== undefined
    ? step === undefined ? t('chat.live.withTurn', { text: operation, duration: elapsed })
      : t('chat.live.withTurnStep', { text: operation, duration: elapsed, step })
    : operation ?? (elapsed === undefined ? t('chat.live.working')
      : step === undefined ? t('chat.live.workingFor', { duration: elapsed })
        : t('chat.live.workingForStep', { duration: elapsed, step }))
  const quietFor = startTime !== undefined && !awaitingUser && quiet >= INACTIVITY_HINT_MS ? quiet : undefined
  return (
    <div className={css.running} data-chat-running>
      <span className={a11yCss.visuallyHidden} role="status" aria-live="polite" aria-atomic="true">{t('chat.live.working')}</span>
      <span className={css.runningDivider} aria-hidden="true" />
      <span className={css.runningContent} data-chat-running-label>
        <RunningWhaleTail />
        <span className={css.runningLines}>
          <TextShimmer active className={css.runningText}>{label}</TextShimmer>
          {task !== undefined && task !== '' && <span className={css.runningTask} data-chat-running-task title={task}>{t('chat.live.task', { task })}</span>}
        </span>
      </span>
      <RunningActivity quietFor={quietFor} onStop={onStop} t={t} />
    </div>
  )
})

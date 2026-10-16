/** Live operation line and quiet-Turn Stop hint under the running indicator. */
import { memo } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import type { LiveActivity } from './live-activity.ts'
import { formatLiveRunDuration } from './message-chrome.ts'
import { formatTokens } from './token-format.ts'
import css from './ChatView.module.css'

type Translate = ChatViewSlotProps['t']

function activityText(activity: LiveActivity, duration: string, t: Translate): string | undefined {
  switch (activity.kind) {
    case 'idle':
      return undefined
    case 'tool': {
      const label = t(`message.stepProcess.${activity.process}`)
      return activity.detail === ''
        ? t('chat.live.tool', { activity: label, duration })
        : t('chat.live.toolDetail', { activity: label, detail: activity.detail, duration })
    }
    case 'job':
      return t(activity.waiting ? 'chat.live.jobWait' : 'chat.live.jobRead', { job: activity.jobId, duration })
    case 'retry':
      return t('chat.live.retry', { attempt: activity.attempt, duration })
    case 'compacting':
      return t('chat.live.compacting', { duration })
    case 'generating': {
      if (activity.tokens === 0) return t(activity.writing ? 'chat.live.writing' : 'chat.live.thinking', { duration })
      const tokens = formatTokens(activity.tokens, t)
      return t(activity.writing ? 'chat.live.writingTokens' : 'chat.live.thinkingTokens', { duration, tokens })
    }
  }
}

interface RunningActivityProps {
  readonly activity: LiveActivity
  readonly since: number | undefined
  readonly now: number
  readonly quietFor: number | undefined
  readonly onStop: () => void
  readonly t: Translate
}

/**
 * Name the in-flight operation and offer Stop once the Turn has been silent.
 * @param props - live activity, its start, the clock, silence duration, Stop action, and copy.
 * @returns the detail line and hint, or nothing when neither applies.
 */
export const RunningActivity = memo(function RunningActivity({
  activity, since, now, quietFor, onStop, t,
}: RunningActivityProps) {
  const text = since === undefined ? undefined
    : activityText(activity, formatLiveRunDuration(Math.max(0, now - since), t), t)
  const quiet = quietFor === undefined ? undefined : formatLiveRunDuration(quietFor, t)
  if (text === undefined && quiet === undefined) return null
  return (
    <div className={css.runningActivity} data-chat-running-activity>
      {text !== undefined && <span className={css.runningActivityText}>{text}</span>}
      {quiet !== undefined && (
        <span className={css.runningStuck} data-chat-running-stuck>
          <span>{t('chat.live.stuck', { duration: quiet })}</span>
          <Button size="sm" variant="outline" onClick={onStop}>{t('chat.live.stop')}</Button>
        </span>
      )}
    </div>
  )
})

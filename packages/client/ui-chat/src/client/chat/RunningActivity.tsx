/** Live operation text and the quiet-Turn Stop hint for the running indicator. */
import { memo } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import type { LiveActivity } from './live-activity.ts'
import { formatRunDuration } from './message-chrome.ts'
import { formatTokens } from './token-format.ts'
import css from './ChatView.module.css'

type Translate = ChatViewSlotProps['t']

/**
 * Name the in-flight operation with its key argument and how long it has run.
 * @param activity - the operation derived from the Chat legacy slice.
 * @param duration - formatted time the operation has been running.
 * @param t - Chat namespace translator.
 * @returns one line such as "Running commands: pnpm test · 3s", or nothing when idle.
 */
export function activityText(activity: LiveActivity, duration: string, t: Translate): string | undefined {
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
  readonly quietFor: number | undefined
  readonly onStop: () => void
  readonly t: Translate
}

/**
 * Offer Stop once the Turn has been silent.
 * @param props - silence duration, Stop action, and copy.
 * @returns the hint, or nothing when the Turn is not quiet.
 */
export const RunningActivity = memo(function RunningActivity({ quietFor, onStop, t }: RunningActivityProps) {
  if (quietFor === undefined) return null
  return (
    <div className={css.runningActivity} data-chat-running-activity>
      <span className={css.runningStuck} data-chat-running-stuck>
        <span>{t('chat.live.stuck', { duration: formatRunDuration(quietFor, t).map(part => part.text).join('') })}</span>
        <Button size="sm" variant="outline" onClick={onStop}>{t('chat.live.stop')}</Button>
      </span>
    </div>
  )
})

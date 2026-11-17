import { useEffect } from 'react'
import type { ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { GlobalStandardProps, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { changesSummaryUrl } from '../changes.ts'
import { ChangedFiles } from './ChangedFiles.tsx'
import type { DeliverablesInjected } from './Deliverables.tsx'
import type { NS } from './locales.ts'
import css from './ChangedFiles.module.css'

export interface ChangedFilesDockInjected extends Pick<DeliverablesInjected, 'loadChangesSummary' | 'loadChangesDiff' | 'openChangesReview'> {
  hooks: Pick<DeliverablesInjected['hooks'], 'changesSummary' | 'changesDiff' | 'showCodeDiff'> & {
    chat: ObservableSnapshot<ChatSnapshot | undefined>
  }
}

export type ChangedFilesDockProps = Pick<PropsRuntime<'conversation.input.dock'>, 'sessionId' | 'useChat'>
  & Pick<GlobalStandardProps, 'useSessions'> & PropsLocale<typeof NS> & InjectFace<ChangedFilesDockInjected>

export function ChangedFilesDock({ sessionId, useSessions, useChat, useShowCodeDiff, useChangesSummary, useChangesDiff,
  loadChangesSummary, loadChangesDiff, openChangesReview, t }: ChangedFilesDockProps) {
  const show = useShowCodeDiff(value => value)
  const announced = useChat(snapshot => {
    const timeline = snapshot?.timeline
    const turn = timeline?.turnOrder.at(-1)
    return turn === undefined ? undefined : timeline?.turns.get(turn)?.data.get('deliverables')?.changes
  })
  const cwd = useSessions(state => state.byId[sessionId]?.cwd)
  const seq = show ? announced?.seq : undefined
  const summary = useChangesSummary(value => seq === undefined ? undefined : value[changesSummaryUrl(sessionId, seq)])
  useEffect(() => {
    if (seq !== undefined && summary === undefined) void loadChangesSummary(sessionId, seq)
  }, [seq, summary, sessionId, loadChangesSummary])
  if (seq === undefined || typeof summary !== 'object' || summary.files.length === 0) return null
  return <div className={css.dock} data-changed-files-dock>
    <ChangedFiles compact changes={{ ...summary, seq }} cwd={cwd} t={t} sessionId={sessionId}
      useChangesDiff={useChangesDiff} loadChangesDiff={loadChangesDiff}
      openReview={index => { openChangesReview({ sessionId, seq, turn: summary.turn }, index) }} />
  </div>
}

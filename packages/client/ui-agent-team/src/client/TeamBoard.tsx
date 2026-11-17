import { useState } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TeamTaskView, TeamTaskId } from '@deepseek-ai/dsh-agent-team/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import {
  IconChecklistOutlineRegular, IconChevronDownOutlineRegular,
  StateDot, Tooltip, type StateDotState,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-subagent/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { NS, type TeamKey } from './locales.ts'
import css from './TeamBoard.module.css'

/** Full props of the task board below the shared subagent catalog. */
export type TeamBoardProps =
  PropsRuntime<'conversation.session.header.actions.subagent.footer'> & PropsLocale<typeof NS>

type VisibleTask = TeamTaskView & { status: Exclude<TeamTaskView['status'], 'deleted'> }

const statusKeys = {
  pending: 'status.pending', in_progress: 'status.in_progress', completed: 'status.completed',
} satisfies Record<VisibleTask['status'], TeamKey>

const dotStates = {
  pending: 'idle', in_progress: 'ongoing', completed: 'done',
} satisfies Record<VisibleTask['status'], StateDotState>

function progressLabel(tasks: readonly VisibleTask[], t: TeamBoardProps['t']): string {
  const completed = tasks.filter(task => task.status === 'completed').length
  const active = tasks.filter(task => task.status === 'in_progress').length
  const pending = tasks.length - completed - active
  return [
    ...completed > 0 ? [t('progress.completed', { count: completed })] : [],
    ...active > 0 ? [t('progress.active', { count: active })] : [],
    ...pending > 0 ? [t('progress.pending', { count: pending })] : [],
  ].join('\u2002·\u2002')
}

function TaskRow({ task, rootId, expanded, onToggle, t }: Pick<TeamBoardProps, 't'> & {
  task: VisibleTask
  rootId: SessionId
  expanded: boolean
  onToggle: () => void
}) {
  const owner = task.ownerName ?? task.ownerId ?? t('unowned')
  const blocked = task.status === 'pending' && !task.ready
  const detailsId = `team-task-${rootId}-${task.id}`
  return (
    <li className={css.task} data-team-task={task.id} data-status={task.status} data-expanded={expanded}>
      <Tooltip label={task.subject} onlyWhenClipped disabled={expanded} delayMs={500} portal side="top">
        <button
          type="button"
          className={css.taskRow}
          aria-expanded={expanded}
          aria-controls={detailsId}
          onClick={onToggle}
        >
          <span className={css.glyph} role="img" aria-label={blocked ? t('blocked') : t(statusKeys[task.status])}>
            <StateDot state={blocked ? 'warning' : dotStates[task.status]} />
          </span>
          <span className={css.subject}>{task.subject}</span>
          <span className={css.chevron} aria-hidden><IconChevronDownOutlineRegular size={14} /></span>
        </button>
      </Tooltip>
      {expanded && (
        <div className={css.details} id={detailsId} data-team-task-details>
          {task.description && <p className={css.description}>{task.description}</p>}
          <p className={css.owner} data-team-task-owner>
            <span className={css.ownerLabel}>{t('owner')}: </span>
            <Tooltip label={owner} onlyWhenClipped delayMs={500} portal side="top">
              <span className={css.ownerValue}>{owner}</span>
            </Tooltip>
          </p>
        </div>
      )}
    </li>
  )
}

/** Render read-only tasks in source order; the enclosing subagent menu owns scrolling. */
export function TeamBoard({ sessionId, useProjection, useSessions, t }: TeamBoardProps) {
  const team = useProjection('agentTeam')
  const hasMembers = useSessions(state => (state.projectionsBySession[sessionId]?.values.subagentCatalog?.length ?? 0) > 0)
  const [expandedTaskId, setExpandedTaskId] = useState<TeamTaskId | null>(null)
  if (!team) return null
  const tasks = team.tasks.filter((task): task is VisibleTask => task.status !== 'deleted')
  const historicalMembers = team.historicalMembers ?? []
  const historicalMessages = team.historicalMessages ?? []
  const hasHistory = historicalMembers.length > 0 || historicalMessages.length > 0
  if (!team.enabled && !hasHistory) return null
  const failure = team.failure === undefined ? null : (
    <div className={css.error} role="alert"><StateDot state="error" />{t('failure', { message: team.failure })}</div>
  )
  const board = tasks.length === 0
    ? failure === null ? null : <div className={css.board}>{failure}</div>
    : (
      <section className={css.board} data-with-members={hasMembers} aria-label={t('trigger')} data-team-panel>
        <h3 className={css.header}>
          <span className={css.lead} aria-hidden><IconChecklistOutlineRegular size={14} /></span>
          <span className={css.title}>{t('tasks')}</span>
          <span className={css.progress}>{progressLabel(tasks, t)}</span>
        </h3>
        {failure}
        <ul className={css.tasks}>
          {tasks.map(task => (
            <TaskRow
              key={task.id} task={task} rootId={sessionId}
              expanded={expandedTaskId === task.id}
              onToggle={() => { setExpandedTaskId(current => current === task.id ? null : task.id) }}
              t={t}
            />
          ))}
        </ul>
      </section>
    )
  const history = !hasHistory ? null : (
    <section className={css.history} aria-label={t('history.title')} data-team-history>
      <h3>{t('history.title')}</h3>
      <p>{t('history.notice')}</p>
      {historicalMembers.length > 0 && (
        <div>
          <h4>{t('history.members')}</h4>
          <ul>
            {historicalMembers.map(member => (
              <li key={member.id} data-historical-member={member.id}>
                <strong>{member.name}</strong> <span>{member.phase}</span>
                <p>{member.description}</p>
                <code>{member.id}</code> <span>{member.provider} · {member.context}</span>
                {member.error !== undefined && <p>{member.error}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {historicalMessages.length > 0 && (
        <div>
          <h4>{t('history.messages')}</h4>
          <ul>
            {historicalMessages.map(({ message, delivered }) => (
              <li key={message.id} data-historical-message={message.id} data-delivered={delivered}>
                <details>
                  <summary>
                    {message.senderName} ({message.senderId}) → {message.targetId} · {t(delivered ? 'history.delivered' : 'history.queued')}
                  </summary>
                  <pre>{message.content.map(block => block.type === 'text' ? block.text : JSON.stringify(block)).join('\n')}</pre>
                </details>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
  if (board === null && history === null) return null
  return <>{board}{history}</>
}

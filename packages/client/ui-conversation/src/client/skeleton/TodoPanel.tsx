import { useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// The domain's client-namespace pure-type outlet: one import edge delivers
// the `todos` projection-key merge (single source, no consumer-side restated
// declare) and the payload type. Type-only by construction — the outlet is
// free of host value imports, so no host Context merge enters this program.
import type { TodoItem } from '@deepseek-ai/dsh-tool-todo/client'
import {
  Button, IconChecklistOutlineRegular, IconChevronDownOutlineRegular, IconChevronUpOutlineRegular, StateDot,
  type StateDotState,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { NS } from '../locales.ts'
import css from './TodoPanel.module.css'

export interface TodoPanelProps {
  /** The session's current plan (empty renders nothing) — selected by the dock adapter. */
  todos: readonly TodoItem[]
  /** The dock entry's locale seat, passed down as a plain prop. */
  t: TodoDockProps['t']
  onCancel?: (content: string | null) => Promise<void>
}

/** Local exhaustiveness helper — client packages do not depend on `dsh-llm`. */
/* v8 ignore next 3 -- closed-union backstop; only reached if status is forged */
function assertNever(value: never): never {
  throw new Error(`unreachable todo status: ${String(value)}`)
}

/** Map Todo lifecycle state onto the shared compact status language. */
function statusDotState(status: TodoItem['status']): StateDotState {
  switch (status) {
    case 'completed': return 'done'
    case 'in_progress': return 'ongoing'
    case 'pending': return 'idle'
    /* v8 ignore next -- closed TodoItem status union */
    default: return assertNever(status)
  }
}

/** Return the localized status announced beside one decorative marker. */
function statusLabel(status: TodoItem['status'], t: TodoPanelProps['t']): string {
  switch (status) {
    case 'completed': return t('todo.status.completed')
    case 'in_progress': return t('todo.status.inProgress')
    case 'pending': return t('todo.status.pending')
    /* v8 ignore next -- closed TodoItem status union */
    default: return assertNever(status)
  }
}

/** Header summary: "·"-joined per-status counts; zero-count segments are omitted as noise (a non-empty list keeps at least one). */
function progressLabel(todos: readonly TodoItem[], t: TodoPanelProps['t']): string {
  const done = todos.filter(item => item.status === 'completed').length
  const active = todos.filter(item => item.status === 'in_progress').length
  const pending = todos.length - done - active
  // En spaces (U+2002): HTML collapses runs of ASCII spaces, so widening the
  // separator breathing room needs a literal wide space.
  return [
    ...done > 0 ? [t('todo.progress.done', { done })] : [],
    ...active > 0 ? [t('todo.progress.active', { active })] : [],
    ...pending > 0 ? [t('todo.progress.pending', { pending })] : [],
  ].join('\u2002·\u2002')
}

export function TodoPanel({ todos, t, onCancel }: TodoPanelProps) {
  const [collapsed, setCollapsed] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const cancel = async (content: string | null): Promise<void> => {
    if (onCancel === undefined || busy) return
    setBusy(true)
    setError(undefined)
    try { await onCancel(content) }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }
  if (todos.length === 0) return null

  return (
    <section className={css.root} data-testid="todo-panel" aria-label={t('todo.title')}>
      <div className={css.body}>
        <div className={css.heading}>
          <button
            type="button"
            className={css.header}
            aria-expanded={!collapsed}
            onClick={() => { setCollapsed(v => !v) }}
          >
            <span className={css.lead} aria-hidden><IconChecklistOutlineRegular /></span>
            <span className={css.title}>{t('todo.title')}</span>
            <span className={css.progress}>{progressLabel(todos, t)}</span>
            <span className={css.chevron} aria-hidden>
              {collapsed ? <IconChevronUpOutlineRegular /> : <IconChevronDownOutlineRegular />}
            </span>
          </button>
          {onCancel !== undefined && todos.some(item => item.status !== 'completed') && (
            <Button size="sm" variant="ghost" disabled={busy} title={t('todo.cancelAllHint')} onClick={() => { void cancel(null) }}>{t('todo.cancelAll')}</Button>
          )}
        </div>
        {error !== undefined && <div role="alert">{error}</div>}
        {!collapsed && (
          <ul className={css.list}>
            {todos.map(item => (
              <li key={item.content} className={css.item} data-status={item.status}>
                <span className={css.glyph} role="img" aria-label={statusLabel(item.status, t)}>
                  <StateDot state={statusDotState(item.status)} />
                </span>
                <span className={css.content}>{item.content}</span>
                {onCancel !== undefined && item.status !== 'completed' && (
                  <Button size="sm" variant="ghost" disabled={busy} aria-label={t('todo.cancelItem', { content: item.content })} title={t('todo.cancelHint')} onClick={() => { void cancel(item.content) }}>{t('todo.cancel')}</Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

/** Props for the projected todo dock. */
export type TodoDockProps = PropsRuntime<'conversation.input.dock'> & PropsLocale<'conversation'> & InjectFace<TodoDockInjected>

/** Callbacks the todo dock receives from its plugin. */
export interface TodoDockInjected {
  cancelTodos: (content: string | null, todos: readonly TodoItem[]) => Promise<void>
}

/** Renders the current todo projection, or nothing when it is absent. */
export function TodoDock({ useProjection, t, cancelTodos }: TodoDockProps) {
  const todos = useProjection('todos')
  return <TodoPanel todos={todos ?? []} t={t} onCancel={content => cancelTodos(content, todos ?? [])} />
}

/** Registers the projected todo dock. */
export const todoDockEntry = {
  name: 'conversation-todo-dock',
  inject: ['slots', 'remote.commands'],
  apply(ctx: Context): void {
    ctx.slots.inject('conversation.input.dock', () =>
      ctx.slots.register({ name: 'conversation.input.dock', id: 'todo', order: 0, locale: NS,
        inject: (sessionId: SessionId): TodoDockInjected => ({
          cancelTodos: async (content, todos) => {
            const expected = JSON.stringify(todos.map(item => [item.content, item.status]))
            const reply = await ctx.remote.commands.execute(sessionId, `/cancel-todos ${JSON.stringify({ expected, content })}`, [])
            if (!reply.ok) throw new Error(reply.error.message)
            if (reply.value === undefined) throw new Error('To-do cancellation is unavailable for this session.')
            if (reply.value.result.kind === 'error') throw new Error(reply.value.result.text)
          },
        }),
      }, TodoDock))
  },
}

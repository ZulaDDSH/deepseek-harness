import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-session-turn-outline/client'
import css from './ModelSelect.module.css'

/** Complete props derived from the composer slot and locale. */
export type RoutedModelProps = PropsRuntime<'conversation.input.right'> & PropsLocale<'model'>

/**
 * Show the model that ran the latest request when it differs from the
 * selected one, as when a router such as Jev picked another model.
 *
 * `lastUsed` outlives its turn, so the label additionally requires the
 * recorded request to belong to the turn now in flight: its `request/header`
 * seq must follow the latest `turn/start` seq, and the session must still be
 * running. Without that, a turn that has not written its own header yet would
 * resurrect the previous turn's routed model.
 *
 * @param props - the session projection, session state, and locale seats.
 * @returns the label while the running turn uses another model, otherwise nothing.
 */
export function RoutedModel({ useSession, useProjection, t }: Pick<RoutedModelProps, 'useSession' | 'useProjection' | 't'>) {
  const selection = useProjection('modelSelection')
  const running = useSession(snapshot => snapshot.running)
  const used = selection?.lastUsed
  const next = selection?.next
  const usedSeq = selection?.lastUsedSeq
  const turnStartSeq = useProjection('turnOutline')?.at(-1)?.seq
  const ranThisTurn = usedSeq !== null && usedSeq !== undefined
    && turnStartSeq !== undefined && usedSeq > turnStartSeq
  if (!running || !ranThisTurn || used === undefined || used === null
    || (next?.provider === used.provider && next.model === used.model)) return null
  return <span className={css.routed} role="status" title={t('routed.title', { provider: used.provider, model: used.model })}>
    {t('routed.label', { model: used.model })}
  </span>
}

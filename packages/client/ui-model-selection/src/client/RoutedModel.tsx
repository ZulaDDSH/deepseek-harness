import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import css from './ModelSelect.module.css'

/** Complete props derived from the composer slot and locale. */
export type RoutedModelProps = PropsRuntime<'conversation.input.right'> & PropsLocale<'model'>

/**
 * Show the model that ran the latest request when it differs from the
 * selected one, as when a router such as Jev picked another model. The label
 * describes the turn in flight, so it is withdrawn once that turn ends.
 * @param props - the session projection, session state, and locale seats.
 * @returns the label while the session runs on another model, otherwise nothing.
 */
export function RoutedModel({ useSession, useProjection, t }: Pick<RoutedModelProps, 'useSession' | 'useProjection' | 't'>) {
  const selection = useProjection('modelSelection')
  const running = useSession(snapshot => snapshot.running)
  const used = selection?.lastUsed
  const next = selection?.next
  if (!running || used === undefined || used === null || (next?.provider === used.provider && next.model === used.model)) return null
  return <span className={css.routed} role="status" title={t('routed.title', { provider: used.provider, model: used.model })}>
    {t('routed.label', { model: used.model })}
  </span>
}

import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import css from './ModelSelect.module.css'

/** Complete props derived from the composer slot and locale. */
export type RoutedModelProps = PropsRuntime<'conversation.input.right'> & PropsLocale<'model'>

/**
 * Show the model that ran the latest request when it differs from the
 * selected one, as when a router such as Jev picked another model.
 * @param props - the session projection seat and locale.
 * @returns the label, or nothing while the selected model is the one running.
 */
export function RoutedModel({ useProjection, t }: Pick<RoutedModelProps, 'useProjection' | 't'>) {
  const selection = useProjection('modelSelection')
  const used = selection?.lastUsed
  const next = selection?.next
  if (used === undefined || used === null || (next?.provider === used.provider && next.model === used.model)) return null
  return <span className={css.routed} role="status" title={t('routed.title', { provider: used.provider, model: used.model })}>
    {t('routed.label', { model: used.model })}
  </span>
}

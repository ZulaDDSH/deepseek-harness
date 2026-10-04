import { useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { MenuSurface, useAnchoredPosition, useDismissOnOutsidePointer } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-session-turn-outline/client'
import type { ModelSelection } from '@deepseek-ai/dsh-api-session-controller/types'
import type { JevDecisionRecord } from '@deepseek-ai/dsh-llm-jev-router/client'
import css from './ModelSelect.module.css'

const MEASURE_STYLE: CSSProperties = { visibility: 'hidden', left: 0, top: 0 }

/** Complete props derived from the composer slot and locale. */
export type JevRoutingProps = PropsRuntime<'conversation.input.right'> & PropsLocale<'model'>

type Translate = JevRoutingProps['t']

function modelName(selection: ModelSelection | null, t: Translate): string {
  return selection === null ? t('routing.unknown') : `${selection.provider} / ${selection.model}`
}

function decisionText(decision: JevDecisionRecord | null, t: Translate): string {
  if (decision === null) return t('routing.none')
  if (decision.error !== undefined) return t('routing.failed', { error: decision.error })
  const confidence = String(Math.round((decision.confidence ?? 0) * 100))
  if (decision.provider !== undefined && decision.model !== undefined) {
    const applied = { provider: decision.provider, model: decision.model, confidence }
    if (decision.route !== undefined && decision.route !== decision.choice) {
      return t('routing.fallback', { ...applied, route: decision.route, choice: decision.choice ?? '' })
    }
    return t('routing.routed', { ...applied, route: decision.route ?? decision.choice ?? '' })
  }
  if (decision.choice === undefined || decision.choice === 'keep') return t('routing.kept', { confidence })
  return t('routing.unsure', { route: decision.choice, confidence })
}

/**
 * Button beside the model picker that opens a panel naming the model running
 * now, the selected model, and Jev's latest routing decision.
 *
 * `lastUsed` outlives its turn, so naming a model as running additionally
 * requires the recorded request to belong to the turn in flight: its
 * `request/header` seq must follow the latest `turn/start` seq, and the
 * session must still be running. Without that identity, the pre-request window
 * of a new turn would present the previous turn's routed model as running.
 *
 * @param props - the session projection, session state, and locale seats.
 * @returns the button, or nothing before Jev has decided and while the selected model is running.
 */
export function JevRouting({ useSession, useProjection, t }: Pick<JevRoutingProps, 'useSession' | 'useProjection' | 't'>) {
  const selection = useProjection('modelSelection')
  const decision = useProjection('jevDecision') ?? null
  const running = useSession(snapshot => snapshot.running)
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  useDismissOnOutsidePointer(anchorRef, open, setOpen, panelRef)
  const position = useAnchoredPosition({ open, anchorRef, panelRef, side: 'top', align: 'end', gap: 6, margin: 12 })
  const used = selection?.lastUsed ?? null
  const next = selection?.next ?? null
  const usedSeq = selection?.lastUsedSeq
  const turnStartSeq = useProjection('turnOutline')?.at(-1)?.seq
  const ranThisTurn = running && usedSeq !== null && usedSeq !== undefined
    && turnStartSeq !== undefined && usedSeq > turnStartSeq
  const routed = ranThisTurn && used !== null && (next === null || used.provider !== next.provider || used.model !== next.model)
  if (decision === null && !routed) return null
  const closeOnEscape = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || !open) return
    event.stopPropagation()
    setOpen(false)
    anchorRef.current?.focus()
  }
  return <>
    <button
      ref={anchorRef}
      type="button"
      className={css.trigger}
      aria-haspopup="dialog"
      aria-expanded={open}
      title={t('routing.open')}
      onClick={() => { setOpen(!open) }}
      onKeyDown={closeOnEscape}
    >
      <span className={css.triggerLabel}>{routed ? t('routing.buttonRouted', { model: used.model }) : t('routing.button')}</span>
    </button>
    {open && createPortal(
      <MenuSurface
        ref={panelRef}
        className={css.routing}
        style={position ?? MEASURE_STYLE}
        role="dialog"
        aria-label={t('routing.title')}
        onKeyDown={closeOnEscape}
      >
        <dl className={css.routingList}>
          <dt>{t('routing.running')}</dt>
          <dd>{modelName(ranThisTurn ? used : null, t)}</dd>
          <dt>{t('routing.selected')}</dt>
          <dd>{modelName(next, t)}</dd>
          <dt>{t('routing.decision')}</dt>
          <dd>{decisionText(decision, t)}</dd>
        </dl>
      </MenuSurface>,
      document.body,
    )}
  </>
}

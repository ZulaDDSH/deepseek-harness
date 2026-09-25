/** One model row of the composer seat's menu: the selectable option and its favorite toggle. */
import type { ReactNode, Ref } from 'react'
import clsx from 'clsx'
import { IconCheckOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ModelChoice } from './model-choices.ts'
import css from './ModelSelect.module.css'

/** The star that marks a favorited model. */
export function FavoriteStar({ filled }: { filled: boolean }): ReactNode {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 1.4 9.95 5.35l4.36.63-3.16 3.08.75 4.35L8 11.36l-3.9 2.05.75-4.35-3.16-3.08 4.36-.63L8 1.4Z" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  )
}

/** Props of one model row. */
export interface ModelRowProps {
  choice: ModelChoice
  selected: boolean
  favorite: boolean
  busy: boolean
  optionRef: Ref<HTMLButtonElement>
  onChoose: () => void
  onToggleFavorite: () => void
  t: TranslateNS<'model'>
}

/**
 * Render one model row: the selectable option plus its favorite toggle.
 * @param props - the row's choice, current state, and the seat's callbacks.
 * @returns the row.
 */
export function ModelRow(
  { choice, selected, favorite, busy, optionRef, onChoose, onToggleFavorite, t }: ModelRowProps,
): ReactNode {
  const favoriteLabel = favorite
    ? t('favorite.remove', { model: choice.model.name })
    : t('favorite.add', { model: choice.model.name })
  return (
    <div className={css.optionRow}>
      <button
        ref={optionRef}
        type="button"
        role="menuitemradio"
        aria-checked={selected}
        className={clsx(css.option, selected && css.selected)}
        title={choice.model.name}
        disabled={busy}
        onClick={onChoose}
      >
        <span className={css.optionCopy}>
          <span className={css.modelName}>{choice.model.name}</span>
        </span>
        <span className={css.check}>
          {selected ? <IconCheckOutlineRegular /> : null}
        </span>
      </button>
      <button
        type="button"
        className={css.favorite}
        aria-label={favoriteLabel}
        aria-pressed={favorite}
        title={favoriteLabel}
        disabled={busy}
        onClick={onToggleFavorite}
      >
        <FavoriteStar filled={favorite} />
      </button>
    </div>
  )
}

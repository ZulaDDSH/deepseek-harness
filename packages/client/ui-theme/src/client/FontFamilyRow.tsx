import clsx from 'clsx'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import { FONT_FAMILIES, fontStackOf, type FontFamily } from '../theme-settings.ts'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { createFontFamilyRowStore } from './settings-store.ts'
import css from './FontFamilyRow.module.css'

/** Injected business face: the preset write. */
export interface FontFamilyRowInjected {
  /** Change the font family preset. */
  setFontFamily: (family: FontFamily) => void
}

/** Full component props: runtime share + store share + locale seat + injected face. */
export type FontFamilyRowComponentProps =
  PropsRuntime<'settings.general.item'> & PropsStore<ReturnType<typeof createFontFamilyRowStore>>
  & PropsLocale<'settings.theme'> & FontFamilyRowInjected

/**
 * Render the font-family row.
 * @param props - composed slot props.
 * @returns the row element tree.
 */
export function FontFamilyRow({ t, setFontFamily, useStore }: FontFamilyRowComponentProps) {
  const fontFamily = useStore(s => s.fontFamily)
  return (
    <div className={css.group}>
      <div className={css.rowText}>
        <div className={css.title}>{t('fontFamily.title')}</div>
        <div className={css.desc}>{t('fontFamily.description')}</div>
      </div>
      <div className={css.options}>
        {FONT_FAMILIES.map(id => (
          <button
            key={id}
            type="button"
            className={clsx(css.option, fontFamily === id && css.selected)}
            style={{ fontFamily: fontStackOf(id) }}
            aria-pressed={fontFamily === id}
            onClick={() => { setFontFamily(id) }}
          >
            {t(`fontFamily.${id}`)}
          </button>
        ))}
      </div>
    </div>
  )
}

/** The General section: preference rows contributed by features, arranged under plain-language headings. */
import { useId } from 'react'
import type {
  HostObservable, InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsKey } from './locales.ts'
import css from './GeneralSection.module.css'

/** Registration-side face: the ids of the rows currently registered, in display order. */
export interface GeneralSectionInjected {
  hooks: { items: HostObservable<readonly string[]> }
}

/** Full component props: section owner share, item render share, copy and the item ledger. */
export type GeneralSectionComponentProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings'>
  & PropsRenderSlots<'settings.general.item'>
  & InjectFace<GeneralSectionInjected>

/** One heading and the row ids filed under it. */
export interface GeneralRowGroup {
  id: string
  labelKey: SettingsKey
  /** Row ids in display order. */
  items: readonly string[]
}

const GROUPS: readonly GeneralRowGroup[] = [
  { id: 'preferences', labelKey: 'general.group.preferences', items: ['permission', 'language', 'appearance', 'font-size'] },
  {
    id: 'conversation', labelKey: 'general.group.conversation',
    items: ['transcript-view', 'performance-usage', 'link-opening', 'composer-enter', 'shortcuts'],
  },
  { id: 'advanced', labelKey: 'general.group.advanced', items: ['developer-tools'] },
  { id: 'privacy', labelKey: 'general.group.privacy', items: ['session-log-deepseek'] },
]
const ABOUT: GeneralRowGroup = { id: 'about', labelKey: 'general.group.about', items: ['current-version'] }

/**
 * Arrange registered row ids under their headings. A row the table does not
 * know keeps the ledger order in the "Advanced" block, so a plugin's row is
 * never dropped.
 * @param registered - row ids in ledger order.
 * @returns non-empty groups.
 */
export function groupGeneralItems(registered: readonly string[]): readonly GeneralRowGroup[] {
  const known = new Set([...GROUPS, ABOUT].flatMap(group => [...group.items]))
  const extra = [...new Set(registered.filter(id => !known.has(id)))]
  const groups = GROUPS.map(group => ({
    ...group,
    items: [
      ...group.items.filter(id => registered.includes(id)),
      ...group.id === 'advanced' ? extra : [],
    ],
  }))
  groups.push({ ...ABOUT, items: ABOUT.items.filter(id => registered.includes(id)) })
  return groups.filter(group => group.items.length > 0)
}

/**
 * Render the General section content column.
 * @param props - composed slot props (contract/slots.ts).
 * @returns the section element tree.
 */
export function GeneralSection({ renderSlot, useItems, t }: GeneralSectionComponentProps) {
  const ids = useItems(items => items)
  const prefix = useId()
  return (
    <div className={css.section}>
      {groupGeneralItems(ids).map(group => (
        <section key={group.id} className={css.group} aria-labelledby={`${prefix}-${group.id}`}>
          <h3 className={css.groupTitle} id={`${prefix}-${group.id}`}>{t(group.labelKey)}</h3>
          {group.items.map(id => (
            <div key={id} className={css.item} data-settings-entry={id}>
              {renderSlot('settings.general.item', {}, { only: id })}
            </div>
          ))}
        </section>
      ))}
    </div>
  )
}

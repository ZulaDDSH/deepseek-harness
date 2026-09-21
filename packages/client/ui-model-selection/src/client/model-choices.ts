/**
 * Row derivation for the composer model seat: the flat choice list, the
 * favorites-and-search projection the menu renders, and the effort rows.
 */
import { useMemo } from 'react'
import type { ModelReasoningEffort } from '@deepseek-ai/dsh-api-remotes/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ModelDirectoryState } from './directory.ts'
import type { ModelSelectInjected } from './slots.ts'

/** One selectable model row and the selection it submits. */
export interface ModelChoice {
  group: ModelDirectoryState['groups'][number]
  model: ModelDirectoryState['groups'][number]['models'][number]
  key: string
  selection: ModelSelectInjected extends never ? never : Parameters<ModelSelectInjected['select']>[0]
}

/** One row of the rendered menu: the favorites section or one provider group. */
export interface VisibleGroup {
  key: string
  name: string
  models: readonly ModelChoice[]
}

/** One dynamic effort row; undefined means preserve the provider default. */
export interface EffortChoice {
  key: string
  effort: string | undefined
  label: string
}

/**
 * Flatten the directory into selectable rows.
 * @param groups - provider groups from the session directory.
 * @returns one choice per model, in directory order.
 */
export function modelChoices(groups: ModelDirectoryState['groups']): readonly ModelChoice[] {
  return groups.flatMap(group =>
    group.models.map(model => ({
      group,
      model,
      key: `${group.id}/${model.id}`,
      selection: {
        provider: group.id,
        model: model.id,
        ...model.reasoning?.defaultEffort === undefined
          ? {}
          : { reasoningEffort: model.reasoning.defaultEffort },
      },
    })))
}

/**
 * Project choices into the rendered groups: a favorites section first, then
 * each provider group, both narrowed by the search query.
 * @param choices - the flat choice list.
 * @param groups - provider groups, which supply each section's name.
 * @param favoriteKeys - row keys the user marked as favorites.
 * @param search - the raw search field value.
 * @param favoritesTitle - localized heading for the favorites section.
 * @returns the sections to render, omitting empty ones.
 */
export function visibleModelGroups(
  choices: readonly ModelChoice[],
  groups: ModelDirectoryState['groups'],
  favoriteKeys: ReadonlySet<string>,
  search: string,
  favoritesTitle: string,
): readonly VisibleGroup[] {
  const query = search.trim().toLocaleLowerCase()
  const matches = (choice: ModelChoice): boolean => query === ''
    || choice.model.name.toLocaleLowerCase().includes(query)
    || choice.model.id.toLocaleLowerCase().includes(query)
    || choice.group.name.toLocaleLowerCase().includes(query)
  const favorites = choices.filter(choice => favoriteKeys.has(choice.key) && matches(choice))
  const sections = groups.map(group => ({
    key: group.id,
    name: group.name,
    models: choices.filter(choice => choice.group.id === group.id
      && !favoriteKeys.has(choice.key) && matches(choice)),
  })).filter(group => group.models.length > 0)
  return favorites.length === 0
    ? sections
    : [{ key: 'favorites', name: favoritesTitle, models: favorites }, ...sections]
}

/**
 * Build the effort rows for the current model's reasoning metadata.
 * @param reasoning - the current model's reasoning metadata, when it accepts one.
 * @param t - the seat's translate function.
 * @returns the effort rows, or an empty list for a model without reasoning.
 */
export function effortChoices(
  reasoning: ModelDirectoryState['groups'][number]['models'][number]['reasoning'],
  t: TranslateNS<'model'>,
): readonly EffortChoice[] {
  if (reasoning === undefined) return []
  return [
    ...reasoning.defaultEffort === undefined
      ? [{ key: 'provider-default', effort: undefined, label: t('effort.providerDefault') }]
      : [],
    ...reasoning.efforts.map((effort: ModelReasoningEffort) => ({
      key: `effort:${effort.id}`,
      effort: effort.id,
      label: effort.name,
    })),
  ]
}

/**
 * Memoize the flat choice list across directory changes.
 * @param groups - provider groups from the session directory.
 * @returns the choice list, rebuilt only when the groups change.
 */
export function useModelChoices(groups: ModelDirectoryState['groups']): readonly ModelChoice[] {
  return useMemo(() => modelChoices(groups), [groups])
}

/**
 * Memoize the rendered sections across choices, favorites, and query changes.
 * @param choices - the flat choice list.
 * @param groups - provider groups, which supply each section's name.
 * @param favoriteKeys - row keys the user marked as favorites.
 * @param search - the raw search field value.
 * @param favoritesTitle - localized heading for the favorites section.
 * @returns the sections to render.
 */
export function useVisibleModelGroups(
  choices: readonly ModelChoice[],
  groups: ModelDirectoryState['groups'],
  favoriteKeys: ReadonlySet<string>,
  search: string,
  favoritesTitle: string,
): readonly VisibleGroup[] {
  return useMemo(
    () => visibleModelGroups(choices, groups, favoriteKeys, search, favoritesTitle),
    [choices, groups, favoriteKeys, search, favoritesTitle],
  )
}

/**
 * Memoize the effort rows across reasoning and locale changes.
 * @param reasoning - the current model's reasoning metadata.
 * @param t - the seat's translate function.
 * @returns the effort rows.
 */
export function useEffortChoices(
  reasoning: ModelDirectoryState['groups'][number]['models'][number]['reasoning'],
  t: TranslateNS<'model'>,
): readonly EffortChoice[] {
  return useMemo(() => effortChoices(reasoning, t), [reasoning, t])
}

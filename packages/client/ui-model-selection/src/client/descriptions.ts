import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ModelDirectoryState } from './directory.ts'
import { en, type ModelKey } from './locales.ts'

/**
 * One selectable row's id: an opaque row key (resolved by lookup, never parsed).
 * @param providerId - the provider group id.
 * @param modelId - the model id within that provider.
 * @returns the row key.
 */
export function rowId(providerId: string, modelId: string): string {
  return `${providerId}/${modelId}`
}

const BUILTIN_DESCRIPTION_KEYS: Readonly<Record<string, ModelKey>> = {
  'deepseek-account/deepseek-v4-flash': 'option.deepseekV4Flash.description',
  'deepseek-account/deepseek-v4-pro': 'option.deepseekV4Pro.description',
  'deepseek-official/deepseek-v4-flash': 'option.deepseekV4Flash.description',
  'deepseek-official/deepseek-v4-pro': 'option.deepseekV4Pro.description',
}

/**
 * Catalog description of one model, with the two built-in DeepSeek copies localized.
 * @param providerId - the provider group id.
 * @param model - the advertised model.
 * @param t - the bound model-namespace translator.
 * @returns the description to display, if any.
 */
export function descriptionOf(
  providerId: string,
  model: ModelDirectoryState['groups'][number]['models'][number],
  t: TranslateNS<'model'>,
): string | undefined {
  const key = BUILTIN_DESCRIPTION_KEYS[rowId(providerId, model.id)]
  return key !== undefined && model.description === en[key] ? t(key) : model.description
}

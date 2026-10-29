/** Theme preferences stored in the Host user-settings document. */

import z from '@deepseek-ai/schemastery'

/** Built-in preferences accepted at the registry and settings boundaries. */
export const THEME_PREFERENCES = ['light', 'dark', 'system'] as const

/** Settings namespace owned by the theme plugin. */
export const THEME_SETTINGS_NAMESPACE = 'ui-theme'

/** Field carrying the selected built-in theme preference. */
export const THEME_PREFERENCE_FIELD = 'preference'

/** Field carrying the conversation content font size. */
export const FONT_SIZE_FIELD = 'fontSize'

/** Field carrying the selected content font family preset. */
export const FONT_FAMILY_FIELD = 'fontFamily'

/** Font family presets: `default` keeps the product stack, the others override it. */
export const FONT_FAMILIES = ['default', 'readable', 'serif', 'dyslexia', 'mono'] as const

/** One font family preset id. */
export type FontFamily = typeof FONT_FAMILIES[number]

/** Font family when the user-settings document has no override. */
export const DEFAULT_FONT_FAMILY: FontFamily = 'default'

/** CSS stack for each overriding preset; `default` has none. */
export const FONT_FAMILY_STACKS: Readonly<Record<Exclude<FontFamily, 'default'>, string>> = {
  readable: "'Atkinson Hyperlegible', Verdana, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', Arial, sans-serif",
  serif: "Charter, 'Iowan Old Style', Georgia, 'Source Serif Pro', 'Songti SC', 'Noto Serif CJK SC', SimSun, serif",
  dyslexia: "'OpenDyslexic', 'Atkinson Hyperlegible', 'Comic Sans MS', 'Trebuchet MS', 'Microsoft YaHei', sans-serif",
  mono: "'SF Mono', 'JetBrains Mono', 'Fira Code', Consolas, 'Liberation Mono', Menlo, 'PingFang SC', 'Microsoft YaHei', monospace",
}

/** Body variable carrying the overriding font stack (absent for `default`). */
export const FONT_FAMILY_VARIABLE = '--dsw-font-family'

/**
 * Resolve a preset to its CSS stack.
 * @param family - preset id.
 * @returns the stack, or undefined for `default`.
 */
export function fontStackOf(family: FontFamily): string | undefined {
  return family === 'default' ? undefined : FONT_FAMILY_STACKS[family]
}

/** Theme preference persisted by the product Appearance row. */
export type ThemePreference = typeof THEME_PREFERENCES[number]

/** Default preference when the user-settings document has no override. */
export const DEFAULT_PREFERENCE: ThemePreference = 'system'

/** Smallest accepted content font size (px). */
export const FONT_SIZE_MIN = 12

/** Largest accepted content font size (px). */
export const FONT_SIZE_MAX = 17

/** Content font size when the user-settings document has no override (px). */
export const DEFAULT_FONT_SIZE = 14

/** Durable theme section shared by the Host schema and the browser scope. */
export interface ThemeSettings {
  /** Selected built-in preference. */
  preference: ThemePreference
  /** Conversation content font size in px (integer within {@link FONT_SIZE_MIN}..{@link FONT_SIZE_MAX}). */
  fontSize: number
  /** Content font family preset. */
  fontFamily: FontFamily
}

/** Durable theme schema; also the wire envelope the browser scope validates against. */
export const ThemeSettingsSchema: z<ThemeSettings> = z.object({
  [THEME_PREFERENCE_FIELD]: z.union([...THEME_PREFERENCES]).default(DEFAULT_PREFERENCE),
  [FONT_SIZE_FIELD]: z.number().step(1).min(FONT_SIZE_MIN).max(FONT_SIZE_MAX).default(DEFAULT_FONT_SIZE),
  [FONT_FAMILY_FIELD]: z.union([...FONT_FAMILIES]).default(DEFAULT_FONT_FAMILY),
})

/**
 * Narrow one wire or registry value to a persistable preference.
 * @param value - value crossing the settings or registry boundary.
 * @returns whether the value is a built-in preference.
 */
export function isThemePreference(value: unknown): value is ThemePreference {
  return THEME_PREFERENCES.some(preference => preference === value)
}

/**
 * Narrow one wire value to a font family preset.
 * @param value - value crossing the settings boundary.
 * @returns whether the value is a preset id.
 */
export function isFontFamily(value: unknown): value is FontFamily {
  return FONT_FAMILIES.some(family => family === value)
}

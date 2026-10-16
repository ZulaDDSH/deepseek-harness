/** Locale bundles for the built-in plugins settings section. */

/** Locale keys the section renders. */
export type PluginsSettingsLocaleKey = 'nav' | 'title' | 'intro' | 'tabs' | 'empty'

/** English copy. */
export const en: Record<PluginsSettingsLocaleKey, string> = {
  nav: 'Built-in plugins',
  title: 'Built-in plugins',
  intro: 'The plugins built into this app. This list is read-only: to turn plugins on or off or change their settings, open Plugins in the sidebar.',
  tabs: 'Plugin views',
  empty: 'This deployment exposes no plugin views.',
}

/** Simplified Chinese copy. */
export const zh: Record<PluginsSettingsLocaleKey, string> = {
  nav: '内置插件',
  title: '内置插件',
  intro: '本应用内置的插件列表，仅供查看。要开启、关闭插件或修改其设置，请打开侧边栏的“插件”。',
  tabs: '插件视图',
  empty: '本部署没有开放任何插件视图。',
}

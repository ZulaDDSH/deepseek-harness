/** `settings.theme` namespace dictionaries (the Appearance and font-size rows' copy). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'appearance.title': '外观',
  'appearance.light': '浅色',
  'appearance.dark': '深色',
  'appearance.system': '跟随系统',
  'fontSize.title': '字号大小',
  'fontSize.description': '仅影响会话内容的字号',
  'fontSize.unit': 'px',
  'fontSize.increase': '增大字号',
  'fontSize.decrease': '减小字号',
  'fontFamily.title': '字体',
  'fontFamily.description': '更换界面和会话内容的字体',
  'fontFamily.default': '默认',
  'fontFamily.readable': '易读',
  'fontFamily.serif': '衬线',
  'fontFamily.dyslexia': '阅读障碍友好',
  'fontFamily.mono': '等宽',
} satisfies Record<string, string>

/** The settings.theme namespace key union. */
export type ThemeKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'appearance.title': 'Appearance',
  'appearance.light': 'Light',
  'appearance.dark': 'Dark',
  'appearance.system': 'System',
  'fontSize.title': 'Font size',
  'fontSize.description': 'Only affects conversation content',
  'fontSize.unit': 'px',
  'fontSize.increase': 'Increase font size',
  'fontSize.decrease': 'Decrease font size',
  'fontFamily.title': 'Font',
  'fontFamily.description': 'Typeface for the interface and conversation',
  'fontFamily.default': 'Default',
  'fontFamily.readable': 'Easy to read',
  'fontFamily.serif': 'Serif',
  'fontFamily.dyslexia': 'Dyslexia-friendly',
  'fontFamily.mono': 'Monospace',
} satisfies Record<ThemeKey, string>

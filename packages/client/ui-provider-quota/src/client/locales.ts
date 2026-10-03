/** Provider quota header dictionaries. */

export const NS = 'provider-quota'

/** Simplified Chinese provider quota dictionary. */
export const zh = {
  title: '用量',
  refresh: '刷新用量',
  loading: '正在加载用量…',
  empty: '没有已配置的用量提供商',
  unavailable: '用量暂不可用',
  error: '加载失败：{message}',
  modelUsage: '本会话的模型用量',
  modelTokens: '{provider} / {model}：{tokens} 个 token',
  accountQuota: '账户配额',
  sharedQuota: '提供商报告的账户限额；可能由多个模型共享。',
  sessionTotal: '本会话：{tokens} 个 token',
  'window.5h': '5 小时',
  'window.weekly': '每周',
  'window.monthly': '每月',
  'window.credits': '余额',
  used: '已用 {percent}%',
  reset: '{time} 重置',
} as const

/** English provider quota dictionary. */
export const en: Record<keyof typeof zh, string> = {
  title: 'Usage',
  refresh: 'Refresh usage',
  loading: 'Loading usage…',
  empty: 'No configured usage providers',
  unavailable: 'Usage unavailable',
  error: 'Failed to load: {message}',
  modelUsage: 'Model usage in this session',
  modelTokens: '{provider} / {model}: {tokens} tokens',
  accountQuota: 'Account quotas',
  sharedQuota: 'Provider-reported account limits; these may be shared across models.',
  sessionTotal: 'This session: {tokens} tokens',
  'window.5h': '5 hours',
  'window.weekly': 'Weekly',
  'window.monthly': 'Monthly',
  'window.credits': 'Credits',
  used: '{percent}% used',
  reset: 'Resets {time}',
}

/** Translation keys owned by the provider quota surface. */
export type ProviderQuotaKey = keyof typeof zh

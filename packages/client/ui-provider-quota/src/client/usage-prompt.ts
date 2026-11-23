/** Usage prompts for the composer dock: a window nearing or at its limit, and the offer to switch back. */

import { browserStorage } from '@deepseek-ai/dsh-client-store'
import type { QuotaResult, QuotaWindow, QuotaWindowId } from '@deepseek-ai/dsh-api-quota-controller/types'

/** Used share at which a window prompts. */
export const NEAR_LIMIT_PERCENT = 90

/** Window length in hours by window id; the longest window is the most prominent prompt. */
const WINDOW_HOURS: Readonly<Record<QuotaWindowId, number>> = { '5h': 5, weekly: 168, 'weekly-opus': 168, 'weekly-sonnet': 168, monthly: 720, overage: 720, credits: 0 }

/** How long a dismissal, or a switch to API credits, lasts for a window that reports no reset time. */
export const OPEN_WINDOW_HOLD_MS = 24 * 60 * 60 * 1000

/** A switch to API credits, kept so the subscription can be offered back once its window resets. */
export interface UsageSwitch {
  readonly providerId: string
  /** When to offer the subscription back: the reset instant of the window the switch answered, else a day after the switch. */
  readonly resetAt?: number
}

/** The inputs a prompt decision reads. */
export interface UsagePromptState {
  /** Prompt keys the user dismissed; each lapses when its window resets. */
  readonly dismissed: ReadonlySet<string>
  /** The last switch to API credits. */
  readonly switched?: UsageSwitch
  /** Unix epoch milliseconds the decision is made at. */
  readonly now: number
  /** Used share at which a window prompts; NEAR_LIMIT_PERCENT when absent. */
  readonly nearLimitPercent?: number
}

/** The one prompt to show now. */
export type UsagePrompt =
  | { readonly kind: 'hard-limit' | 'near-limit'; readonly key: string; readonly result: QuotaResult; readonly windowId: QuotaWindowId; readonly window: QuotaWindow }
  | { readonly kind: 'switch-back'; readonly key: string; readonly result: QuotaResult; readonly switched: UsageSwitch }

/**
 * Whether a window's status is something other than `ok`, which the provider uses to say it cannot serve.
 * @param window - one normalized quota window.
 * @returns true when the provider reported a non-ok status.
 */
export function hardLimited(window: QuotaWindow): boolean {
  return window.status !== undefined && window.status.toLowerCase() !== 'ok'
}

const OPEN_KEY_TAIL = '|open'

function windowScope(key: string): string {
  return `${key.split('|').slice(0, 3).join('|')}|`
}

function isDismissed(dismissed: ReadonlySet<string>, key: string, now: number): boolean {
  const scope = windowScope(key)
  for (const entry of dismissed) {
    if (entry.startsWith(scope) && Number(entry.slice(entry.lastIndexOf('|') + 1)) > now) return true
  }
  return false
}

function limitKey(kind: 'hard-limit' | 'near-limit', providerId: string, windowId: QuotaWindowId, window: QuotaWindow): string {
  return `${kind === 'hard-limit' ? 'hard' : 'limit'}|${providerId}|${windowId}|${window.resetAt ?? 'open'}`
}

/**
 * The prompt to show, if any: a hard limit or a window at or past the near-limit share, most prominent
 * first, otherwise the offer to switch back to the subscription after the switched window reset.
 * @param results - quota results for every configured provider.
 * @param state - dismissals, the last switch, and the decision time.
 * @returns the prompt, or undefined when nothing needs the user.
 */
export function usagePrompt(results: readonly QuotaResult[], state: UsagePromptState): UsagePrompt | undefined {
  const threshold = state.nearLimitPercent ?? NEAR_LIMIT_PERCENT
  const candidates: Array<Extract<UsagePrompt, { windowId: QuotaWindowId }>> = []
  for (const result of results) {
    if (!result.configured || !result.ok || result.billing?.active === 'api') continue
    for (const windowId of Object.keys(WINDOW_HOURS) as QuotaWindowId[]) {
      const window = result.windows?.[windowId]
      if (window === undefined) continue
      if (window.resetAt !== null && window.resetAt <= state.now) continue
      const hard = hardLimited(window)
      if (!hard && (window.usedPercent === null || window.usedPercent < threshold)) continue
      const kind = hard ? 'hard-limit' : 'near-limit'
      const key = limitKey(kind, result.providerId, windowId, window)
      if (isDismissed(state.dismissed, key, state.now)) continue
      candidates.push({ kind, key, result, windowId, window })
    }
  }
  candidates.sort((left, right) => Number(right.kind === 'hard-limit') - Number(left.kind === 'hard-limit')
    || WINDOW_HOURS[right.windowId] - WINDOW_HOURS[left.windowId])
  const [top] = candidates
  if (top !== undefined) return top
  const switched = state.switched
  if (switched?.resetAt === undefined || state.now < switched.resetAt) return undefined
  const key = `back|${switched.providerId}|${switched.resetAt}`
  const result = results.find(entry => entry.providerId === switched.providerId && entry.configured && entry.ok
    && entry.billing?.active === 'api' && entry.billing.switch !== undefined)
  return result === undefined || state.dismissed.has(key) ? undefined : { kind: 'switch-back', key, result, switched }
}

/** Persisted prompt memory: dismissed keys and the last switch to API credits. */
export interface UsagePromptStore {
  dismissed(): readonly string[]
  saveDismissed(keys: readonly string[]): void
  switched(): UsageSwitch | undefined
  saveSwitched(value: UsageSwitch | undefined): void
}

const DISMISSED_KEY = 'dsh.provider-quota.dismissed'
const SWITCHED_KEY = 'dsh.provider-quota.switched'

function parse(raw: string | null): unknown {
  if (raw === null) return undefined
  try { const value: unknown = JSON.parse(raw); return value } catch { return undefined }
}

/**
 * The browser-storage memory for usage prompts; without storage nothing persists.
 * @param storage - the storage to use, or undefined when none is available.
 * @returns the prompt memory.
 */
export function localUsagePromptStore(storage: Storage | undefined = browserStorage()): UsagePromptStore {
  const read = (key: string): string | null => {
    try { return storage?.getItem(key) ?? null } catch { return null }
  }
  const write = (action: (target: Storage) => void): void => {
    try { if (storage !== undefined) action(storage) } catch { return }
  }
  return {
    dismissed() {
      const value = parse(read(DISMISSED_KEY))
      return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
    },
    saveDismissed(keys) {
      write(target => { target.setItem(DISMISSED_KEY, JSON.stringify(keys)) })
    },
    switched() {
      const value = parse(read(SWITCHED_KEY)) as { providerId?: unknown; resetAt?: unknown } | null | undefined
      if (typeof value !== 'object' || value === null || typeof value.providerId !== 'string') return undefined
      return typeof value.resetAt === 'number' ? { providerId: value.providerId, resetAt: value.resetAt } : { providerId: value.providerId }
    },
    saveSwitched(value) {
      write((target) => {
        if (value === undefined) target.removeItem(SWITCHED_KEY)
        else target.setItem(SWITCHED_KEY, JSON.stringify(value))
      })
    },
  }
}

/**
 * Add a dismissed prompt key, dropping keys whose window has already reset. A window with no reset time
 * (a key ending `|open`) is dismissed for OPEN_WINDOW_HOLD_MS, stored as the key plus its expiry.
 * @param keys - keys currently remembered.
 * @param key - the key the user dismissed.
 * @param now - Unix epoch milliseconds of the dismissal.
 * @returns the remembered keys after the dismissal.
 */
export function withDismissed(keys: readonly string[], key: string, now: number): string[] {
  const scope = windowScope(key)
  const live = keys.filter((entry) => {
    const reset = Number(entry.slice(entry.lastIndexOf('|') + 1))
    return !entry.endsWith(OPEN_KEY_TAIL) && !entry.startsWith(scope) && (!Number.isFinite(reset) || reset >= now)
  })
  const stored = key.endsWith(OPEN_KEY_TAIL) ? `${key}|${now + OPEN_WINDOW_HOLD_MS}` : key
  return live.includes(stored) ? live : [...live, stored]
}

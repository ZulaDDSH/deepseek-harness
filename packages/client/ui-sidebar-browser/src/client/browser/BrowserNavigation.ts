/** URL, history, and observability state for one Browser tab. */
import type { BrowserAddressFailure, BrowserTarget } from './url.ts'
import { browserTargetOf } from './url.ts'

/** Maximum retained application-known navigation entries per tab. */
export const MAX_BROWSER_HISTORY = 100

/** One canonical address in the application-managed Web history. */
export type BrowserHistoryEntry = BrowserTarget

/** Whether the current carrier document still corresponds to an application-known URL. */
export type BrowserNavigationStatus =
  | { readonly status: 'empty' }
  | { readonly status: 'loading'; readonly revision: number }
  | { readonly status: 'known'; readonly revision: number }
  | { readonly status: 'unknown'; readonly revision: number }

/** Address-policy or loading failure shown below the toolbar. */
export type BrowserFailure =
  { readonly kind: 'address'; readonly reason: BrowserAddressFailure }

/** One Browser tab's serializable URL state. */
export interface BrowserTabState {
  readonly entries: readonly BrowserHistoryEntry[]
  readonly index: number
  /** Last application-directed load; carrier observations do not rewrite it. */
  readonly request: { readonly revision: number; readonly target: BrowserTarget } | undefined
  readonly navigation: BrowserNavigationStatus
  readonly failure: BrowserFailure | undefined
  /**
   * Address the carrier last observed when it no longer matches the current
   * application-known entry: an in-page or site-managed navigation the harness
   * did not direct (for example a route change inside a single-page app). It is
   * persisted so a remount restores the live page instead of the address the
   * tab originally opened, and cleared once the carrier is back on a known one.
   */
  readonly observed: string | undefined
}

/**
 * Owns the application-known URL history and the iframe observation state machine.
 * The first load for a request keeps its URL authoritative; another load marks it unknown.
 */
export class BrowserNavigation {
  private value: BrowserTabState

  /**
   * @param initial - persisted state restored for this tab, or a fresh empty state.
   */
  constructor(initial: BrowserTabState = BrowserNavigation.empty()) {
    this.value = initial
  }

  /**
   * Create state before a tab has a controlled navigation target.
   * @returns empty serializable state.
   */
  static empty(): BrowserTabState {
    return { entries: [], index: -1, request: undefined, navigation: { status: 'empty' }, failure: undefined, observed: undefined }
  }

  /**
   * Read the selected application-history entry.
   * @param state - serializable tab state.
   * @returns the current target, if any.
   */
  static current(state: BrowserTabState | undefined): BrowserHistoryEntry | undefined {
    return state === undefined || state.index < 0 ? undefined : state.entries[state.index]
  }

  /**
   * Test whether the Web carrier can use the preceding application-history entry.
   * @param state - serializable tab state.
   * @returns whether Back is available.
   */
  static canGoBack(state: BrowserTabState): boolean {
    return state.navigation.status !== 'unknown' && state.index > 0
  }

  /**
   * Test whether the Web carrier can use the following application-history entry.
   * @param state - serializable tab state.
   * @returns whether Forward is available.
   */
  static canGoForward(state: BrowserTabState): boolean {
    return state.navigation.status !== 'unknown'
      && state.index >= 0
      && state.index < state.entries.length - 1
  }

  /** Current immutable serializable state. */
  get snapshot(): BrowserTabState {
    return this.value
  }

  /** Whether the Web iframe can safely use the application-owned Back entry. */
  get canGoBack(): boolean {
    return BrowserNavigation.canGoBack(this.value)
  }

  /** Whether the Web iframe can safely use the application-owned Forward entry. */
  get canGoForward(): boolean {
    return BrowserNavigation.canGoForward(this.value)
  }

  /**
   * Add a controlled target and discard its stale forward branch.
   * @param target - validated canonical target.
   * @returns the new load request.
   */
  navigate(target: BrowserTarget): NonNullable<BrowserTabState['request']> {
    const entries = [...this.value.entries.slice(0, this.value.index + 1), target]
    if (entries.length > MAX_BROWSER_HISTORY) entries.splice(0, entries.length - MAX_BROWSER_HISTORY)
    return this.request(target, { ...this.value, entries, index: entries.length - 1 })
  }

  /**
   * Select the preceding application-known target.
   * @returns a new load request, or undefined when unavailable.
   */
  back(): BrowserTabState['request'] {
    if (!this.canGoBack) return undefined
    const index = this.value.index - 1
    const target = this.value.entries[index] as BrowserHistoryEntry
    return this.request(target, { ...this.value, index })
  }

  /**
   * Select the following application-known target.
   * @returns a new load request, or undefined when unavailable.
   */
  forward(): BrowserTabState['request'] {
    if (!this.canGoForward) return undefined
    const index = this.value.index + 1
    const target = this.value.entries[index] as BrowserHistoryEntry
    return this.request(target, { ...this.value, index })
  }

  /**
   * The address a carrier action should treat as current: the observed live
   * address when the carrier left the application-known entry, otherwise that
   * entry's address.
   * @param state - serializable tab state.
   * @returns the effective address, or undefined before any target.
   */
  static effectiveUrl(state: BrowserTabState | undefined): string | undefined {
    return state?.observed ?? BrowserNavigation.current(state)?.url
  }

  /**
   * Record an address the carrier navigated to on its own.
   *
   * An observation that matches the current application-known entry spends any
   * earlier observation; one outside the HTTP(S) allowlist is ignored.
   * @param url - absolute address the carrier reported.
   * @returns whether the recorded state changed.
   */
  observe(url: string): boolean {
    const current = BrowserNavigation.current(this.value)
    // A report that matches the known entry spends an earlier observation; a
    // report outside the allowlist is not evidence and leaves state alone.
    if (url === current?.url) {
      if (this.value.observed === undefined) return false
      this.value = { ...this.value, observed: undefined }
      return true
    }
    const target = browserTargetOf(url)
    if (target === undefined || target.url === this.value.observed) return false
    this.value = { ...this.value, observed: target.url }
    return true
  }

  /**
   * Start another load of the current entry, preferring a carrier-observed
   * address so a remount restores the live page rather than the address the
   * tab originally opened. A consumed observation replaces its history entry.
   * @returns a new load request, or undefined before the first target.
   */
  reload(): BrowserTabState['request'] {
    const current = BrowserNavigation.current(this.value)
    if (current === undefined) return undefined
    const observed = this.value.observed
    const target = observed === undefined ? current : browserTargetOf(observed) ?? current
    const entries = target.url === current.url
      ? this.value.entries
      : [...this.value.entries.slice(0, this.value.index), target, ...this.value.entries.slice(this.value.index + 1)]
    return this.request(target, { ...this.value, entries })
  }

  /**
   * Record an invalid address without changing the active document state.
   * @param reason - parser refusal.
   */
  addressFailed(reason: BrowserAddressFailure): void {
    this.value = { ...this.value, failure: { kind: 'address', reason } }
  }

  /**
   * Record a frame load for its captured revision.
   * @param revision - revision bound to the rendered frame.
   */
  frameLoaded(revision: number): void {
    const navigation = this.value.navigation
    if (navigation.status === 'empty' || navigation.revision !== revision) return
    if (navigation.status === 'loading') {
      this.value = { ...this.value, navigation: { status: 'known', revision } }
    } else if (navigation.status === 'known') {
      this.value = { ...this.value, navigation: { status: 'unknown', revision } }
    }
  }

  private request(
    target: BrowserTarget,
    basis: BrowserTabState,
  ): NonNullable<BrowserTabState['request']> {
    const request = { revision: (this.value.request?.revision ?? 0) + 1, target }
    this.value = {
      ...basis,
      request,
      navigation: { status: 'loading', revision: request.revision },
      failure: undefined,
      observed: undefined,
    }
    return request
  }
}

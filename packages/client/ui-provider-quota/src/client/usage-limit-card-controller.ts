/** Staged usage warning share, backed by the Host's quota-controller settings section. */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import {
  SettingsFormModel, settingsNumberField,
  type SettingsFieldSpec, type SettingsFieldState, type SettingsFormActions, type SettingsFormScope, type SettingsFormShell,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { NEAR_LIMIT_PERCENT } from './usage-prompt.ts'

/** Settings namespace of the quota controller, which holds the usage warning share. */
export const QUOTA_NS = 'quota-controller'
/** Lowest usage warning share a user can set. */
export const NEAR_LIMIT_MIN = 50
/** Highest usage warning share a user can set. */
export const NEAR_LIMIT_MAX = 100

/** Host-owned usage settings. */
export interface UsageLimitSettings {
  nearLimitPercent: number
}

/** Effective values and drafts presented by the usage limit card. */
export interface UsageLimitCardState extends SettingsFormShell {
  nearLimitPercent: SettingsFieldState
}

/** Actions and observable state bound by the slot renderer. */
export interface UsageLimitCardFace extends SettingsFormActions {
  hooks: {
    usageLimitCard: SnapshotStore<UsageLimitCardState>
  }
}

function nearLimitField(): SettingsFieldSpec {
  const numeric = settingsNumberField('nearLimitPercent')
  return {
    ...numeric,
    parse: (text) => {
      const write = numeric.parse(text)
      if (write?.kind !== 'set') return write
      const value = write.value as number
      return Number.isSafeInteger(value) && value >= NEAR_LIMIT_MIN && value <= NEAR_LIMIT_MAX ? write : undefined
    },
  }
}

function effectiveNearLimit(settings: UsageLimitSettings | undefined): number {
  return settings?.nearLimitPercent ?? NEAR_LIMIT_PERCENT
}

/** Stage the usage warning share and publish the Host-accepted share the composer prompt reads. */
export class UsageLimitCardController {
  private readonly form: SettingsFormModel<UsageLimitSettings>
  private readonly store: SnapshotStore<UsageLimitCardState>
  /** The Host-accepted share; the default until the Host serves one. */
  readonly nearLimit: SnapshotStore<number>
  private readonly unsubscribe: () => void

  /** @param scope - The Host's quota-controller settings section. */
  constructor(scope: SettingsFormScope<UsageLimitSettings>) {
    this.form = new SettingsFormModel(scope, [nearLimitField()])
    this.store = this.form.bind(() => ({
      ...this.form.shell(),
      nearLimitPercent: this.form.field('nearLimitPercent'),
    }))
    this.nearLimit = createSnapshotStore(effectiveNearLimit(scope.getSnapshot().value))
    this.unsubscribe = scope.subscribe(() => { this.nearLimit.set(effectiveNearLimit(scope.getSnapshot().value)) })
  }

  /**
   * Bind the usage limit editor to the slot renderer.
   * @returns The card snapshot and staged write actions.
   */
  inject(): UsageLimitCardFace {
    return { hooks: { usageLimitCard: this.store }, ...this.form.actions() }
  }

  /** Release accepted-value subscriptions. */
  dispose(): void {
    this.unsubscribe()
    this.form.dispose()
  }
}

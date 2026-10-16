/** The Claude Code page's staged form over the `subagent-claude-code` settings namespace. */

import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import {
  SettingsFormModel,
  type SettingsFieldSpec, type SettingsFieldState, type SettingsFormActions, type SettingsFormScope, type SettingsFormShell,
} from '@deepseek-ai/dsh-client-ui-primitives'

/** Spelled here, not imported: client packages must not depend on Host packages. */
export const CLAUDE_CODE_NS = 'subagent-claude-code'

/** The Claude Code fields this page edits. */
export interface ClaudeCodeSettings {
  /** Profile default for native ultracode; absent leaves Claude Code's own settings in charge. */
  ultracode?: boolean
}

/** What the Claude Code page renders. */
export interface ClaudeCodeCardState extends SettingsFormShell {
  /** The Ultracode switch's draft text, `true` or `false`. */
  ultracode: SettingsFieldState
}

/** The registration-side face the Claude Code page's slot entry injects. */
export interface ClaudeCodeCardFace extends SettingsFormActions {
  hooks: {
    /** Page snapshot bound by the renderer as useClaudeCodeCard. */
    claudeCodeCard: SnapshotStore<ClaudeCodeCardState>
  }
}

function ultracodeField(): SettingsFieldSpec {
  return {
    field: 'ultracode',
    format: value => value === true ? 'true' : 'false',
    parse: (text) => {
      if (text === 'true' || text === 'false') return { kind: 'set', value: text === 'true' }
      return text === '' ? { kind: 'clear' } : undefined
    },
  }
}

/** Bridges the `subagent-claude-code` scope onto the page's staged form. */
export class ClaudeCodeCardController {
  private readonly form: SettingsFormModel<ClaudeCodeSettings>
  private readonly store: SnapshotStore<ClaudeCodeCardState>

  /** @param scope - the bound settings scope for the `subagent-claude-code` namespace. */
  constructor(scope: SettingsFormScope<ClaudeCodeSettings>) {
    this.form = new SettingsFormModel(scope, [ultracodeField()])
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): ClaudeCodeCardState {
    return { ...this.form.shell(), ultracode: this.form.field('ultracode') }
  }

  /**
   * Build the face the page's slot registration injects.
   * @returns the page's snapshot and its form actions.
   */
  inject(): ClaudeCodeCardFace {
    return { hooks: { claudeCodeCard: this.store }, ...this.form.actions() }
  }

  /** Release accepted-value subscriptions. */
  dispose(): void { this.form.dispose() }
}

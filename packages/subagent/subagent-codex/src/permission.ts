/**
 * Codex `thread/start` permission fields for a Profile-selected mode, clamped
 * to the delegating parent Session's file sandbox.
 *
 * @module @deepseek-ai/dsh-subagent-codex/permission
 */

import { SubagentError, type ParentSandboxMode } from '@deepseek-ai/dsh-subagent'
import type { CodexPermissionMode } from './run.ts'

/** Official `thread/start` permission fields for one Codex run. */
export type CodexThreadPermission = Readonly<Record<string, unknown>>

const THREAD_PERMISSION_PARAMS: Readonly<Record<CodexPermissionMode, CodexThreadPermission>> = {
  never: { approvalPolicy: 'never' },
  'approve-for-me': {
    approvalPolicy: 'on-request',
    approvalsReviewer: 'auto_review',
    sandbox: 'workspace-write',
  },
  'dangerously-bypass-approvals-and-sandbox': {
    approvalPolicy: 'never',
    sandbox: 'danger-full-access',
  },
}

/**
 * Official `thread/start` permission fields for a Profile mode under the delegating parent's file sandbox.
 * @param mode - Profile-selected Codex permission mode.
 * @param parentSandbox - the parent Session's resolved sandbox mode, or `undefined` without a sandbox policy.
 * @returns the fields spread into `thread/start`.
 * @throws {SubagentError} `PARENT_SANDBOX_MISMATCH` for the bypass mode under a parent that is not `danger-full-access`.
 */
export function codexThreadPermission(
  mode: CodexPermissionMode,
  parentSandbox?: ParentSandboxMode,
): CodexThreadPermission {
  if (parentSandbox === undefined || parentSandbox === 'danger-full-access') {
    return THREAD_PERMISSION_PARAMS[mode]
  }
  if (mode === 'dangerously-bypass-approvals-and-sandbox') {
    throw new SubagentError(
      `subagent-codex: permissionMode "${mode}" requires a danger-full-access parent session; the parent session is ${parentSandbox}`,
      'PARENT_SANDBOX_MISMATCH',
    )
  }
  if (parentSandbox === 'read-only') {
    return { approvalPolicy: 'never', sandbox: 'read-only' }
  }
  return { approvalPolicy: 'never', sandbox: 'workspace-write' }
}

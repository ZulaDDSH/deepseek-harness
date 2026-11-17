/**
 * Classify the Agent SDK failure facts a Claude Code run observes, and name
 * the advisory tool-use progress lines of an assistant message. The assistant
 * error codes form a closed SDK union, so an unmapped code is a type error.
 *
 * @module @deepseek-ai/dsh-subagent-claude-code/sdk-messages
 */

import type {
  SDKAssistantMessage,
  SDKAssistantMessageError,
} from '@anthropic-ai/claude-agent-sdk'

/** Failure bucket a Claude Code run's SDK facts classify into; `unknown` is the fallback. */
export type ClaudeCodeFailureCategory =
  | 'limit'
  | 'access-policy'
  | 'service'
  | 'product-error'
  | 'invalid-result'
  | 'process'
  | 'unknown'

/**
 * Classify an SDK result subtype into its failure bucket; unrecognised subtypes are `unknown`.
 * @param subtype - the SDK result subtype string.
 * @returns the failure category.
 */
export function sdkFailureCategory(
  subtype: string,
): ClaudeCodeFailureCategory {
  switch (subtype) {
    case 'error_max_turns':
    case 'error_max_budget_usd':
    case 'error_max_structured_output_retries':
      return 'limit'
    case 'error_during_execution':
      return 'product-error'
    default:
      return 'unknown'
  }
}

/**
 * Failure facts the provider observed before the SDK result message. A later
 * assistant message without an error clears an earlier assistant error.
 */
export interface SdkFailureContext {
  readonly assistantError?: SDKAssistantMessageError | undefined
  readonly resetsAt?: number | undefined
}

const ASSISTANT_ERROR_CATEGORIES: Readonly<Record<SDKAssistantMessageError, ClaudeCodeFailureCategory | undefined>> = {
  authentication_failed: 'access-policy',
  oauth_org_not_allowed: 'access-policy',
  account_on_hold: 'access-policy',
  verification_required: 'access-policy',
  cloud_credential_error: 'access-policy',
  billing_error: 'limit',
  rate_limit: 'limit',
  max_output_tokens: 'limit',
  overloaded: 'service',
  server_error: 'service',
  model_not_found: 'product-error',
  invalid_request: 'product-error',
  unknown: undefined,
}

/**
 * Map an observed assistant error to its failure category.
 * @param error - SDK assistant error code.
 * @returns the fixed category, or undefined when the code carries no category.
 */
export function assistantErrorCategory(error: SDKAssistantMessageError): ClaudeCodeFailureCategory | undefined {
  return ASSISTANT_ERROR_CATEGORIES[error]
}

/**
 * Describe an observed assistant error for the failure diagnostic.
 * @param error - SDK assistant error code.
 * @param resetsAt - rate-limit reset time from the latest rate-limit event, if any.
 * @returns the detail text, or undefined when the error carries no category.
 */
export function assistantErrorDetail(error: SDKAssistantMessageError, resetsAt?: number): string | undefined {
  const category = assistantErrorCategory(error)
  if (category === undefined) return undefined
  if (category !== 'limit' || resetsAt === undefined || !Number.isFinite(resetsAt)) return error
  // The SDK documents no unit for resetsAt; 1e12 separates epoch seconds from milliseconds.
  const time = new Date(resetsAt < 1e12 ? resetsAt * 1000 : resetsAt)
  if (Number.isNaN(time.getTime())) return error
  return `${error}, resets at ${time.toISOString()}`
}

function toolInputValue(input: unknown): string | undefined {
  if (typeof input !== 'object' || input === null) return undefined
  if ('file_path' in input && typeof input.file_path === 'string') return input.file_path
  if ('command' in input && typeof input.command === 'string') return input.command
  if ('pattern' in input && typeof input.pattern === 'string') return input.pattern
  return undefined
}

/**
 * Name each tool use in an assistant message by its most identifying input.
 * @param message - assistant message from the SDK stream.
 * @returns one advisory line per tool_use block, untruncated.
 */
export function toolUseProgressLines(message: SDKAssistantMessage): string[] {
  const lines: string[] = []
  for (const block of message.message.content) {
    if (block.type !== 'tool_use') continue
    const value = toolInputValue(block.input)
    lines.push(value === undefined ? block.name : `${block.name}: ${value}`)
  }
  return lines
}

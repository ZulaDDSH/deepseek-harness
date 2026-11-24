import { HarnessError } from '@deepseek-ai/dsh-error'

export const FREEBUFF_LOGIN_COMMAND = 'freebuff login'

export class FreebuffNotInstalledError extends HarnessError {
  constructor(executable: string, options?: ErrorOptions) {
    super(
      `subagent-freebuff: the Freebuff CLI "${executable}" was not found. Install the Freebuff CLI or set the provider's executable to its absolute path.`,
      'FREEBUFF_NOT_INSTALLED',
      options,
    )
  }
}

export class FreebuffNotLoggedInError extends HarnessError {
  constructor(readonly reason: string) {
    super(
      `subagent-freebuff: Freebuff is not logged in (${reason}). Run \`${FREEBUFF_LOGIN_COMMAND}\` in a terminal as the same user, then retry. This provider never handles Freebuff credentials.`,
      'FREEBUFF_NOT_LOGGED_IN',
    )
  }
}

export type FreebuffFailureStage = 'startup' | 'turn' | 'process' | 'teardown'

export type FreebuffFailureCategory =
  | 'blocked'
  | 'limit'
  | 'process'
  | 'product-error'
  | 'invalid-result'
  | 'unknown'

export class FreebuffRunFailure extends HarnessError {
  constructor(
    readonly stage: FreebuffFailureStage,
    readonly category: FreebuffFailureCategory,
    readonly detail?: string,
    readonly screenTail?: string,
    cause?: unknown,
  ) {
    super(
      `subagent-freebuff: Product subagent failure (product: Freebuff; stage: ${stage}; category: ${category}${detail === undefined ? '' : `; detail: ${detail}`})`,
      'FREEBUFF_RUN_FAILED',
      cause === undefined ? undefined : { cause },
    )
  }
}

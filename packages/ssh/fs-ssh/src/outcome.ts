import { FsError } from '@deepseek-ai/dsh-fs'

export class FsOutcomeUnknownError extends FsError {
  readonly outcomeUnknown = true as const
}

export function isOutcomeUnknown(error: unknown): error is FsOutcomeUnknownError {
  return error instanceof FsOutcomeUnknownError
}

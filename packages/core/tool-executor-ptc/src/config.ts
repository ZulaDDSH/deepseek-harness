/** Configuration shared by plugin mounting and direct executor construction. @module */
import z from '@deepseek-ai/schemastery'

/** Program execution limits. */
export interface Config {
  /** Nested tool-call attempts per minute of resolved runtime timeout, including failed calls. */
  maxSubCallsPerMinute: number
  /** Maximum overlapping concurrency-safe program subcalls. */
  maxParallelSubCalls: number
  /** Constraint: a binding value over this many estimated UTF-8 bytes must be rejected. */
  maxBindingResultBytes: number
  /** Constraint: one run_code must not receive more than this many estimated bytes in total. */
  maxProgramResultBytes: number
}

/** Validated timeout-based call allowance and concurrency; parallelism of one makes subcalls serial. */
export const Config: z<Partial<Config>, Config> = z.object({
  maxSubCallsPerMinute: z.natural().min(1).default(1024),
  maxParallelSubCalls: z.natural().min(1).default(10),
  maxBindingResultBytes: z.natural().min(1).default(16 * 1024 * 1024),
  maxProgramResultBytes: z.natural().min(1).default(64 * 1024 * 1024),
})

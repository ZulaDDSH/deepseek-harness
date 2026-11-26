import { resolveRetryPolicy } from '@deepseek-ai/dsh-llm'

export const name = 'claude-legacy-request-recovery'

const emptyToolStop = 'The native response stopped for tools but published none.'
const legacyPolicy = resolveRetryPolicy({
  mode: 'normal',
  maxRetries: 3,
  retryableCodes: ['MALFORMED_RESPONSE', 'SERVER'],
  backoff: { initialDelayMs: 5000, maxDelayMs: 30000 },
}, 'claude-legacy-request-recovery')

export function apply(ctx) {
  ctx.on('agent/request-error', async (request, next) => {
    const { provider, failure, retryPolicy } = request
    const claude = provider === 'claude-code-session' || provider.startsWith('claude-sub-')
    const recoverable = failure.code === 'SERVER' ||
      (failure.code === 'MALFORMED_RESPONSE' && failure.message === emptyToolStop)
    if (!claude || !recoverable || retryPolicy?.mode !== 'normal' || retryPolicy.maxRetries !== 0)
      return next()

    // The request-error waterfall shares one request record. Pass the policy
    // to the host's retry service only for this failed inference step.
    request.retryPolicy = legacyPolicy
    try {
      return await next()
    } finally {
      request.retryPolicy = retryPolicy
    }
  }, { global: true, prepend: true })
}

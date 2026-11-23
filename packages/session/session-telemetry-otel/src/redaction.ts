const REDACTED = '[redacted]'

const SECRET_PATTERNS: readonly (readonly [RegExp, string])[] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gu, REDACTED],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/gu, `Bearer ${REDACTED}`],
  [/\bsk-[A-Za-z0-9_-]{16,}/gu, REDACTED],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/gu, REDACTED],
  [/\bAKIA[0-9A-Z]{16}\b/gu, REDACTED],
  [/(:\/\/[^\s/:@]+:)[^\s/@]+@/gu, `$1${REDACTED}@`],
  [/(\b(?:api[_-]?key|secret|token|password|passwd)["']?\s*[:=]\s*["']?)[^\s"',;]{6,}/giu, `$1${REDACTED}`],
]

export function redactSecretsInString(text: string): string {
  let out = text
  for (const [pattern, replacement] of SECRET_PATTERNS) out = out.replace(pattern, replacement)
  return out
}

function walk(value: unknown): unknown {
  if (typeof value === 'string') return redactSecretsInString(value)
  if (Array.isArray(value)) return value.map(walk)
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, walk(item)]))
  }
  return value
}

export function redactSecrets<T>(body: T): T {
  return walk(body) as T
}

export function localOnlyFeedbackBody(eventType: string | undefined, body: unknown): unknown {
  if (eventType !== 'feedback/record') return body
  if (typeof body !== 'object' || body === null || (body as { localOnly?: unknown }).localOnly !== true) return body
  return { localOnly: true }
}

import type { ExternalChatSource } from './types.ts'

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined
}

/**
 * Keep only the transcript fields chat discovery and import read, dropping tool output and other bulky payloads.
 * @param source - external chat tool that wrote the record.
 * @param row - one parsed transcript record.
 * @returns a reduced copy of the record.
 */
export function compactExternalRecord(source: ExternalChatSource, row: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const key of ['type', 'uuid', 'parentUuid', 'cwd', 'customTitle', 'isSidechain', 'isMeta']) {
    if (key in row) result[key] = row[key]
  }
  const payload = record(row['payload'])
  if (source === 'codex' && row['type'] === 'session_meta') result['payload'] = { cwd: payload?.['cwd'] }
  const message = source === 'codex'
    ? row['type'] === 'response_item' && payload?.['type'] === 'message' ? payload : undefined
    : row['type'] === 'user' || row['type'] === 'assistant' ? record(row['message']) : undefined
  if (message === undefined || row['isSidechain'] === true || row['isMeta'] === true) return result
  if (message['role'] !== 'user' && message['role'] !== 'assistant') return result
  const content = message['content']
  const text = typeof content === 'string' ? content : Array.isArray(content)
    ? content.flatMap((part: unknown) => {
      const block = record(part)
      return block !== undefined && ['text', 'input_text', 'output_text'].includes(String(block['type']))
        && typeof block['text'] === 'string' ? [block['text']] : []
    }).join('\n') : ''
  const value = { role: message['role'], content: text, id: message['id'], type: message['type'] }
  result[source === 'codex' ? 'payload' : 'message'] = value
  return result
}

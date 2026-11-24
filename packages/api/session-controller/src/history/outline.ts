import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { SessionOutlineEntry, SessionOutlinePage } from '../types.ts'

export const OUTLINE_PAGE_LIMIT = 500
export const OUTLINE_SCAN_LIMIT = 20_000
const PROMPT_PREVIEW_LIMIT = 50
const RESPONSE_PREVIEW_LIMIT = 120

type MessageContent = SessionEvent<'user/message'>['data']['content']
type MutableEntry = { -readonly [K in keyof SessionOutlineEntry]: SessionOutlineEntry[K] }

function preview(content: MessageContent, limit: number): string {
  let text = ''
  let unread = false
  for (const block of content) {
    if (block.type !== 'text') continue
    if (text.length >= limit * 2) {
      unread = true
      break
    }
    const clipped = block.text.length > limit * 2
    const chunk = clipped ? block.text.slice(0, limit * 2) : block.text
    text += text === '' ? chunk : ` ${chunk}`
    if (clipped) {
      unread = true
      break
    }
  }
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length > limit - 1) return `${normalized.slice(0, limit - 1).trimEnd()}…`
  return unread ? `${normalized}…` : normalized
}

function fold(events: readonly SessionEvent[], start: number, end: number): SessionOutlineEntry[] {
  const turns: MutableEntry[] = []
  let draft = ''
  for (let index = start; index < end; index++) {
    const event = events[index] as SessionEvent
    const last = turns.at(-1)
    switch (event.type) {
      case 'turn/start':
        if (last !== undefined && event.data.turn <= last.turn) break
        turns.push({ turn: event.data.turn, seq: event.seq, prompt: '', response: '' })
        draft = ''
        break
      case 'user/message': {
        if (event.data.source.kind !== 'user' || last === undefined || last.prompt !== '') break
        last.prompt = preview(event.data.content, PROMPT_PREVIEW_LIMIT)
        break
      }
      case 'assistant/message': {
        const next = preview(event.data.message.content, RESPONSE_PREVIEW_LIMIT)
        if (next !== '') draft = next
        break
      }
      case 'turn/end':
        if (draft !== '' && last !== undefined) last.response = draft
        draft = ''
        break
      default:
        break
    }
  }
  return turns
}

export function outlinePage(
  events: readonly SessionEvent[], end: number, maxEntries: number, scanLimit = OUTLINE_SCAN_LIMIT,
): SessionOutlinePage {
  const floor = Math.max(0, end - scanLimit)
  let start = end
  let found = 0
  while (start > floor && found < maxEntries) {
    start--
    if ((events[start] as SessionEvent).type === 'turn/start') found++
  }
  return { entries: fold(events, start, end), hasMore: start > 0, before: start }
}

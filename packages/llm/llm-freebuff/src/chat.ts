import { readdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'

const CHAT_FILE = 'chat-messages.json'

export interface ChatBlock {
  readonly type?: string
  readonly content?: unknown
  readonly textType?: string
  readonly toolName?: string
  readonly input?: unknown
  readonly output?: unknown
}

export interface ChatMessage {
  readonly id?: string
  readonly variant?: string
  readonly content?: unknown
  readonly blocks?: readonly ChatBlock[]
  readonly isComplete?: boolean
  readonly userError?: unknown
  readonly textAttachments?: unknown
}

export function squash(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

export function chatsDirOf(configDir: string, cwd: string): string {
  return join(configDir, 'projects', basename(cwd), 'chats')
}

export function listChats(chatsDir: string): string[] {
  try {
    return readdirSync(chatsDir)
  } catch (_missing) {
    return []
  }
}

export function readChat(chatsDir: string, chatId: string): ChatMessage[] | undefined {
  try {
    const rows: unknown = JSON.parse(readFileSync(join(chatsDir, chatId, CHAT_FILE), 'utf8'))
    return Array.isArray(rows) ? rows as ChatMessage[] : undefined
  } catch (_unreadable) {
    return undefined
  }
}

export function rowText(message: ChatMessage): string {
  return typeof message.content === 'string' ? message.content : ''
}

export function bindChat(chatsDir: string, before: ReadonlySet<string>, prompt: string): string | undefined {
  const wanted = squash(prompt)
  const fresh = listChats(chatsDir).filter(id => !before.has(id)).sort()
  const firstUsers = fresh.map(id => ({ id, user: readChat(chatsDir, id)?.find(row => row.variant === 'user') }))
  const exact = firstUsers.find(({ user }) => user !== undefined && squash(rowText(user)) === wanted)
  if (exact !== undefined) return exact.id
  const attached = firstUsers.filter(({ user }) => Array.isArray(user?.textAttachments))
  return attached.length === 1 && firstUsers.length === 1 ? attached[0]?.id : undefined
}

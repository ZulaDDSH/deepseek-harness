import { readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, isAbsolute, join } from 'node:path'

const CHAT_MESSAGES_FILENAME = 'chat-messages.json'

export interface FreebuffTranscript {
  readonly complete: boolean
  readonly answer: string
  readonly error: string | undefined
}

export function freebuffConfigDir(env: Readonly<Record<string, string | undefined>>, home: string = homedir()): string {
  const configured = env.FREEBUFF_CONFIG_DIR
  return configured !== undefined && isAbsolute(configured) ? configured : join(home, '.config', 'manicode')
}

function mtimeOf(path: string): number | undefined {
  try {
    return statSync(path).mtimeMs
  } catch (_missing) {
    return undefined
  }
}

export function findChatFile(configDir: string, cwd: string, since: number): string | undefined {
  const chatsDir = join(configDir, 'projects', basename(cwd), 'chats')
  let names: string[]
  try {
    names = readdirSync(chatsDir)
  } catch (_missing) {
    return undefined
  }
  let newest: { file: string, mtime: number } | undefined
  for (const name of names) {
    const file = join(chatsDir, name, CHAT_MESSAGES_FILENAME)
    const mtime = mtimeOf(file)
    if (mtime !== undefined && mtime >= since && (newest === undefined || mtime > newest.mtime)) {
      newest = { file, mtime }
    }
  }
  return newest?.file
}

interface ChatBlock {
  readonly type?: unknown
  readonly content?: unknown
  readonly textType?: unknown
}

interface ChatMessage {
  readonly variant?: unknown
  readonly content?: unknown
  readonly blocks?: unknown
  readonly isComplete?: unknown
  readonly userError?: unknown
}

function messageText(message: ChatMessage): string {
  if (Array.isArray(message.blocks)) {
    const text = (message.blocks as ChatBlock[])
      .filter(block => block.type === 'text' && block.textType !== 'reasoning' && typeof block.content === 'string')
      .map(block => block.content as string)
      .join('\n')
      .trim()
    if (text.length > 0) return text
  }
  return typeof message.content === 'string' ? message.content.trim() : ''
}

export function readTranscript(file: string): FreebuffTranscript | undefined {
  let messages: unknown
  try {
    messages = JSON.parse(readFileSync(file, 'utf8'))
  } catch (_unreadable) {
    return undefined
  }
  if (!Array.isArray(messages)) return undefined
  const all = messages as ChatMessage[]
  const lastUser = all.findLastIndex(message => message.variant === 'user')
  if (lastUser < 0) return undefined
  const reply = all.slice(lastUser + 1)
  const ai = reply.filter(message => message.variant === 'ai' && messageText(message).length > 0).at(-1)
  const failed = reply.find(message => typeof message.userError === 'string' || message.variant === 'error')
  const error = failed === undefined ? undefined : typeof failed.userError === 'string' ? failed.userError : messageText(failed)
  return {
    complete: ai?.isComplete === true,
    answer: ai === undefined ? '' : messageText(ai),
    error,
  }
}

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

function readMessages(file: string): ChatMessage[] | undefined {
  try {
    const messages: unknown = JSON.parse(readFileSync(file, 'utf8'))
    return Array.isArray(messages) ? messages as ChatMessage[] : undefined
  } catch (_unreadable) {
    return undefined
  }
}

function squash(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

export function findChatFile(configDir: string, cwd: string, since: number, task: string): string | undefined {
  const chatsDir = join(configDir, 'projects', basename(cwd), 'chats')
  let names: string[]
  try {
    names = readdirSync(chatsDir)
  } catch (_missing) {
    return undefined
  }
  const wanted = squash(task)
  const candidates: { file: string; mtime: number }[] = []
  for (const name of names) {
    const file = join(chatsDir, name, CHAT_MESSAGES_FILENAME)
    const mtime = mtimeOf(file)
    if (mtime !== undefined && mtime >= since) candidates.push({ file, mtime })
  }
  candidates.sort((left, right) => right.mtime - left.mtime)
  return candidates.find(({ file }) => {
    const user = readMessages(file)?.findLast(message => message.variant === 'user')
    return user !== undefined && squash(messageText(user)) === wanted
  })?.file
}

export function readTranscript(file: string): FreebuffTranscript | undefined {
  const all = readMessages(file)
  if (all === undefined) return undefined
  const lastUser = all.findLastIndex(message => message.variant === 'user')
  if (lastUser < 0) return undefined
  const reply = all.slice(lastUser + 1)
  const aiIndex = reply.findLastIndex(message => message.variant === 'ai' && messageText(message).length > 0)
  const ai = reply[aiIndex]
  const failedIndex = reply.findLastIndex(message => typeof message.userError === 'string' || message.variant === 'error')
  const failed = reply[failedIndex]
  const recovered = failed !== undefined && aiIndex > failedIndex && ai?.isComplete === true
  const error = failed === undefined || recovered
    ? undefined
    : typeof failed.userError === 'string' ? failed.userError : messageText(failed)
  return {
    complete: ai?.isComplete === true,
    answer: ai === undefined ? '' : messageText(ai),
    error,
  }
}

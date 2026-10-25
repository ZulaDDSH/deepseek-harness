import type { ExternalChatCatalog, ExternalChatImportValue, ExternalChatKey } from '@deepseek-ai/dsh-api-session-controller/client'

/**
 * Import every catalog chat that is not already known.
 * @param catalog - discovered external chats.
 * @param known - keys of chats already imported.
 * @param importChats - imports the selected chats.
 * @param signal - stops the sync when aborted.
 * @returns a promise that settles after the missing chats are imported.
 */
export async function syncMissingChats(
  catalog: ExternalChatCatalog,
  known: Set<string>,
  importChats: (keys: readonly ExternalChatKey[]) => Promise<ExternalChatImportValue>,
  signal: AbortSignal,
): Promise<void> {
  const missing = catalog.items.filter(chat => chat.error === undefined && !known.has(`imported-chat-${chat.key}`))
  const errors: string[] = []
  for (let offset = 0; offset < missing.length && !signal.aborted; offset += 100) {
    const result = await importChats(missing.slice(offset, offset + 100).map(chat => chat.key))
    for (const item of result.items) {
      if (item.sessionId !== undefined) known.add(item.sessionId)
      if (item.error !== undefined) errors.push(item.error)
    }
  }
  if (errors.length) throw new Error(errors.join('\n'))
}

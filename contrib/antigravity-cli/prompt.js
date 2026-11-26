import {createHash} from 'node:crypto'

/** Extract effective system prompt text from options.system and leading/in-history system messages. */
export function extractSystemPrompt(options) {
  const parts = []
  if (typeof options.system === 'string' && options.system.trim()) parts.push(options.system.trim())
  for (const msg of options.messages ?? []) {
    if (msg.role !== 'system') continue
    const text = messageText(msg)
    if (text) parts.push(text)
  }
  return parts.join('\n\n')
}

export function buildSystemAppend(harnessSystem, hasTools) {
  const rules = [
    'DeepSeek Harness host rules (mandatory):',
    '- You are serving as the language model inside a DeepSeek Harness conversation.',
    hasTools
      ? '- NEVER invoke Antigravity built-in tools (run_command, view_file, write_to_file, replace_file_content, multi_replace_file_content, grep_search, find_by_name, list_dir, browser_*, invoke_subagent, etc.). They point to an empty temp directory and are blocked. ALWAYS use the Harness MCP tools (prefixed `mcp_dsh_`) to read/edit files, run commands, and perform workspace actions.'
      : '- NEVER invoke any Antigravity built-in tools. Answer directly using only the provided text and images.',
    '- Follow the Harness system instructions below as authoritative for this conversation.',
  ]
  if (harnessSystem) {
    rules.push('', '--- Harness System Instructions ---', harnessSystem)
  }
  return rules.join('\n')
}

export function messageText(message) {
  if (typeof message?.content === 'string') return message.content
  if (!Array.isArray(message?.content)) return ''
  return message.content
    .filter(block => block?.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('\n')
    .trim()
}

export function messageFingerprint(message) {
  const normalized = {
    role: message.role,
    id: message.id,
    toolCallId: message.toolCallId,
    isError: message.isError,
    content: Array.isArray(message.content)
      ? message.content.map(block => {
          if (block.type === 'image') {
            return {type: 'image', id: block.attachment?.attachmentId, offloaded: block.offloaded === true}
          }
          if (block.type === 'tool-call') {
            return {type: 'tool-call', id: block.id, name: block.name, arguments: block.arguments}
          }
          if (block.type === 'text' || block.type === 'reasoning') {
            return {type: block.type, text: block.text}
          }
          return block
        })
      : message.content,
  }
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex')
}

export function nonSystemMessages(messages = []) {
  return messages.filter(msg => msg.role !== 'system')
}

async function resolveImageBlock(block, attachments, signal) {
  if (block.offloaded || !block.attachment) {
    return {type: 'text', text: `[Offloaded image: ${block.attachment?.name || 'image'}]`}
  }
  if (!attachments?.readImage) {
    return {type: 'text', text: `[Image attachment unavailable: ${block.attachment.name || 'image'}]`}
  }
  try {
    const {data} = await attachments.readImage(block.attachment, signal)
    const mimeType = block.attachment.mediaType || 'image/png'
    return {type: 'image', data: Buffer.from(data).toString('base64'), mimeType}
  } catch (error) {
    if (signal?.aborted) throw error
    return {type: 'text', text: `[Could not load image ${block.attachment.name || ''}: ${error.message}]`}
  }
}

/** Convert a Harness tool result message into MCP `tools/call` content blocks (text + images). */
export async function toMcpToolResult(toolMessage, attachments, signal) {
  const blocks = []
  const items = Array.isArray(toolMessage?.content)
    ? toolMessage.content
    : typeof toolMessage?.content === 'string'
      ? [{type: 'text', text: toolMessage.content}]
      : []
  for (const block of items) {
    if (block.type === 'text') {
      blocks.push({type: 'text', text: block.text ?? ''})
    } else if (block.type === 'image') {
      blocks.push(await resolveImageBlock(block, attachments, signal))
    }
  }
  return {
    content: blocks.length ? blocks : [{type: 'text', text: ''}],
    isError: Boolean(toolMessage?.isError),
  }
}

function formatHistoryMessageText(msg) {
  if (msg.role === 'user') return messageText(msg)
  if (msg.role === 'developer') {
    const text = messageText(msg)
    return text ? `[Harness developer notice]\n${text}` : ''
  }
  if (msg.role === 'assistant') {
    const parts = []
    for (const block of Array.isArray(msg.content) ? msg.content : []) {
      if (block.type === 'text' && block.text) parts.push(block.text)
      else if (block.type === 'tool-call') parts.push(`[Called tool ${block.name}(${block.arguments})]`)
    }
    return parts.join('\n')
  }
  if (msg.role === 'tool') {
    const text = messageText(msg)
    return `[Tool result for ${msg.toolCallId || 'call'}${msg.isError ? ' (error)' : ''}]\n${text}`
  }
  return messageText(msg)
}

/**
 * Serialize one or more Harness messages into ACP `session/prompt` content blocks
 * (preserving native image blocks alongside text).
 */
export async function buildPromptBlocks(messages, {attachments, signal, isReplay = false} = {}) {
  const blocks = []
  const list = nonSystemMessages(messages)
  if (!isReplay && list.length === 1 && list[0].role === 'user') {
    const msg = list[0]
    const items = Array.isArray(msg.content) ? msg.content : [{type: 'text', text: String(msg.content ?? '')}]
    for (const block of items) {
      if (block.type === 'text' && block.text) blocks.push({type: 'text', text: block.text})
      else if (block.type === 'image') blocks.push(await resolveImageBlock(block, attachments, signal))
    }
    return blocks.length ? blocks : [{type: 'text', text: 'Continue.'}]
  }

  const textChunks = []
  if (isReplay && list.length > 1) {
    textChunks.push('Conversation transcript so far (continue from the latest message):')
  }
  for (const msg of list) {
    const label = msg.role === 'user' ? 'User' : msg.role === 'assistant' ? 'Assistant' : msg.role === 'tool' ? 'Tool' : 'Harness'
    const text = formatHistoryMessageText(msg)
    if (text) textChunks.push(list.length > 1 || isReplay ? `[${label}]\n${text}` : text)
    if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'image') {
          if (textChunks.length) {
            blocks.push({type: 'text', text: textChunks.join('\n\n')})
            textChunks.length = 0
          }
          blocks.push(await resolveImageBlock(block, attachments, signal))
        }
      }
    }
  }
  if (textChunks.length) {
    blocks.push({type: 'text', text: textChunks.join('\n\n')})
  }
  return blocks.length ? blocks : [{type: 'text', text: 'Continue.'}]
}

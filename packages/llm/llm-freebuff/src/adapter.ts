import type { Context } from '@deepseek-ai/cordis'
import {
  LlmAdapter,
  LlmError,
  resolveRetryPolicy,
  type GenerateOptions,
  type LlmModelInfo,
  type LlmProviderInfo,
  type RequestMessage,
  type ResolvedRetryPolicy,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import { resolveParentSandboxMode } from '@deepseek-ai/dsh-subagent'
import { FREEBUFF_KEY, PROVIDER, type FreebuffAccount } from './auth.ts'
import type { RenderedBlock } from './markdown.ts'
import type { FreebuffPool } from './session.ts'

export const MODEL_ID = 'default'
const MODEL_DESCRIPTION = 'Freebuff chooses the model and runs its own tools in your workspace. Replies take minutes and carry no token counts.'

export interface FreebuffReplay {
  readonly kind: 'freebuff'
  readonly version: 1
  readonly chatId: string
  readonly consumed?: string
}

export function promptOf(messages: readonly RequestMessage[]): string {
  const latest = messages.findLast(message => message.role === 'user' && (message.source === undefined || message.source.kind === 'user'))
  if (latest === undefined) throw new LlmError('The request holds no user message to send to Freebuff.', 'INVALID_REQUEST')
  const texts: string[] = []
  for (const block of latest.content) {
    if (block.type !== 'text') {
      throw new LlmError('Freebuff accepts text prompts only; remove the attached images or files.', 'UNSUPPORTED_CONTENT')
    }
    texts.push(block.text)
  }
  const prompt = texts.join('\n\n').replaceAll('\r\n', '\n').replace(/[^\P{Cc}\n\t]/gu, '').trim()
  if (prompt.length === 0) throw new LlmError('The prompt for Freebuff is empty.', 'INVALID_REQUEST')
  if (/^[/!]/.test(prompt)) {
    throw new LlmError('A Freebuff prompt must not start with "/" or "!" because Freebuff would run it as a command. Rephrase the message.', 'INVALID_REQUEST')
  }
  return prompt
}

export function resumeOf(messages: readonly RequestMessage[]): FreebuffReplay | undefined {
  for (const message of messages.toReversed()) {
    if (message.role !== 'assistant' || message.source.provider !== PROVIDER) continue
    const state = message.source.replayState as Partial<FreebuffReplay> | undefined
    if (state?.kind === 'freebuff' && state.version === 1 && typeof state.chatId === 'string') {
      return { kind: 'freebuff', version: 1, chatId: state.chatId, ...typeof state.consumed === 'string' ? { consumed: state.consumed } : {} }
    }
  }
  return undefined
}

export class FreebuffAdapter extends LlmAdapter {
  constructor(
    private readonly ctx: Context,
    private readonly pool: FreebuffPool,
    private readonly account: FreebuffAccount,
  ) {
    super()
  }

  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: 'Freebuff' }
  }

  override providerRetryPolicy(): ResolvedRetryPolicy {
    return resolveRetryPolicy({ mode: 'normal', maxRetries: 0 }, 'llm-freebuff')
  }

  override async listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    const status = await this.account.reconcile()
    if (status === 'signed-out') return []
    if (status === 'unknown' && !(await this.ctx.credentials.describeRecord(FREEBUFF_KEY)).configured) return []
    return [{ provider, id: MODEL_ID, name: 'Freebuff', description: MODEL_DESCRIPTION, inputModalities: ['text'] }]
  }

  override async *stream(options: GenerateOptions): AsyncGenerator<StreamChunk> {
    if (options.purpose !== undefined) {
      throw new LlmError(`Freebuff cannot serve the background request "${options.purpose}" because it would be typed into your visible Freebuff chat.`, 'UNSUPPORTED_OPTION')
    }
    if (options.sessionId === undefined) throw new LlmError('Freebuff needs a harness session to keep its chat.', 'INVALID_REQUEST')
    const session = this.ctx.sessions.get(options.sessionId)
    if (session === undefined) throw new LlmError('The harness session of this Freebuff request is unknown.', 'INVALID_REQUEST')
    const sandbox = resolveParentSandboxMode(this.ctx, session)
    if (sandbox !== undefined && sandbox !== 'danger-full-access') {
      throw new LlmError(`Freebuff cannot be confined to a sandbox and needs a danger-full-access session; this session is ${sandbox}.`, 'UNSUPPORTED_OPTION')
    }
    const prompt = promptOf(options.messages)
    const resume = resumeOf(options.messages)
    const turn = this.pool.session(options.sessionId).turn({
      prompt,
      cwd: this.ctx.workingDirectory.get(session),
      chatId: resume?.chatId,
      consumed: resume?.consumed,
      signal: options.signal ?? new AbortController().signal,
    })
    const shown: { kind: RenderedBlock['kind'], text: string }[] = []
    try {
      for (;;) {
        const next = await turn.next()
        if (next.done === true) {
          for (const [index, block] of shown.entries()) yield { type: 'block-end', index, block: { type: block.kind, text: block.text } }
          const replay: FreebuffReplay = {
            kind: 'freebuff',
            version: 1,
            chatId: next.value.chatId,
            consumed: next.value.consumed,
          }
          yield { type: 'finish', reason: { kind: 'stop' }, replayState: { response: replay } }
          return
        }
        for (const [index, block] of next.value.entries()) {
          let current = shown[index]
          if (current === undefined) {
            yield { type: 'block-start', index, blockType: block.kind }
            current = { kind: block.kind, text: '' }
            shown[index] = current
          }
          if (current.kind !== block.kind || !block.text.startsWith(current.text) || block.text.length === current.text.length) continue
          const text = block.text.slice(current.text.length)
          current.text = block.text
          yield block.kind === 'text' ? { type: 'text-delta', index, text } : { type: 'reasoning-delta', index, text }
        }
      }
    } finally {
      await turn.return({ chatId: '', consumed: '' })
    }
  }
}

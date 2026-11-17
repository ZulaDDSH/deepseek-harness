import { BlockAssembler, type ContentBlock, type GenerateOptions, type LlmRuntime, type StreamChunk } from '@deepseek-ai/dsh-llm'
import type { HookOutput } from '@deepseek-ai/dsh-hook-protocol'
import type { PromptHook } from './config.ts'

/** Default time budget for one prompt hook model call, in milliseconds. */
export const PROMPT_HOOK_TIMEOUT_MS = 30_000

const ARGUMENTS_TOKEN = '$ARGUMENTS'

const PROMPT_SYSTEM = [
  'You decide one Claude Code hook. Reply with exactly one JSON object and no other text.',
  'Reply {"ok": true} to allow the action the hook input describes, or {"ok": false, "reason": "<short reason>"} to block it, following the hook instructions.',
  'Add "impossible": true only when a Stop hook can never be satisfied.',
].join('\n')

/** The provider and model one prompt hook model call runs on. */
export interface PromptRoute {
  readonly provider: string
  readonly model: string
}

/** A parsed prompt hook verdict: allow, or block with an optional reason and an impossible flag. */
export type PromptVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason?: string; readonly impossible: boolean }

/**
 * Build the text a prompt hook sends to the model.
 * @param prompt - the hook prompt, which may contain `$ARGUMENTS`.
 * @param payload - the hook input, serialized as JSON.
 * @returns the prompt with each `$ARGUMENTS` replaced by the JSON, or the prompt followed by the JSON.
 */
export function promptRequestText(prompt: string, payload: unknown): string {
  const input = JSON.stringify(payload)
  const parts = prompt.split(ARGUMENTS_TOKEN)
  return parts.length === 1 ? `${prompt}\n\n${input}` : parts.join(input)
}

function firstJsonObject(text: string): string {
  const start = text.indexOf('{')
  if (start === -1) throw new Error('prompt hook reply has no JSON object')
  let depth = 0
  let inString = false
  for (let index = start; index < text.length; index += 1) {
    const char = text.charAt(index)
    if (inString) {
      if (char === '\\') index += 1
      else if (char === '"') inString = false
    } else if (char === '"') {
      inString = true
    } else if (char === '{') {
      depth += 1
    } else if (char === '}') {
      depth -= 1
      if (depth === 0) return text.slice(start, index + 1)
    }
  }
  throw new Error('prompt hook reply has an unterminated JSON object')
}

/**
 * Read the verdict from a model reply.
 * @param text - the reply text; its first JSON object is the verdict.
 * @returns the parsed verdict.
 */
export function parseVerdict(text: string): PromptVerdict {
  const record = JSON.parse(firstJsonObject(text)) as Record<string, unknown>
  if (typeof record.ok !== 'boolean') throw new Error('prompt hook reply has no boolean "ok"')
  if (record.ok) return { ok: true }
  return {
    ok: false,
    ...typeof record.reason === 'string' ? { reason: record.reason } : {},
    impossible: record.impossible === true,
  }
}

async function readReply(stream: AsyncIterable<StreamChunk>): Promise<string> {
  const assembler = new BlockAssembler()
  let finished = false
  for await (const chunk of stream) {
    assembler.push(chunk)
    if (chunk.type === 'finish') finished = true
  }
  if (!finished) throw new Error('prompt hook model emitted no terminal finish')
  const { finish } = assembler
  if (finish.kind === 'error' || finish.kind === 'aborted') throw new Error(`prompt hook model failed: ${finish.failure.message}`)
  if (finish.kind !== 'stop') throw new Error(`prompt hook model ended with ${finish.kind}`)
  const texts = assembler.blocks().filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
  return texts.map(block => block.text).join('')
}

function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  const aborted = new Promise<never>((_resolve, reject) => {
    signal.addEventListener('abort', () => { reject(new Error(String(signal.reason))) }, { once: true })
  })
  return Promise.race([work, aborted])
}

/**
 * Ask the model for one prompt hook verdict through the model service, with no tools.
 * @param llm - the model service.
 * @param route - the provider and model to call.
 * @param text - the request text from {@link promptRequestText}.
 * @param signal - aborts the call.
 * @returns the verdict; rejects when the call fails or ends without a usable reply.
 */
export async function askModel(llm: LlmRuntime, route: PromptRoute, text: string, signal: AbortSignal): Promise<PromptVerdict> {
  signal.throwIfAborted()
  const options: GenerateOptions = {
    provider: route.provider,
    model: route.model,
    system: PROMPT_SYSTEM,
    messages: [{ role: 'user', content: [{ type: 'text', text }] }],
    temperature: 0,
    signal,
  }
  return parseVerdict(await untilAborted(readReply(llm.stream(options)), signal))
}

function endsTurn(point: string, hook: PromptHook, impossible: boolean): boolean {
  switch (point) {
    case 'UserPromptSubmit':
      return true
    case 'PreToolUse':
    case 'PostToolUse':
      return hook.continueOnBlock !== true
    case 'Stop':
      return impossible
    default:
      return false
  }
}

/**
 * Map a prompt verdict onto the hook output for one event.
 * @param point - the event the hook runs on.
 * @param hook - the prompt hook, whose continueOnBlock applies to tool events.
 * @param verdict - the parsed verdict.
 * @returns an empty output for an allow, else a deny with the reason, plus continue:false when the block ends the turn.
 */
export function verdictOutput(point: string, hook: PromptHook, verdict: PromptVerdict): HookOutput {
  if (verdict.ok) return { exitCode: undefined, stderr: '', stdout: '' }
  const reason = verdict.reason ?? `blocked by ${point} prompt hook`
  const block: HookOutput = { exitCode: undefined, stderr: reason, stdout: '', decision: 'deny', reason }
  return endsTurn(point, hook, verdict.impossible) ? { ...block, continue: false, stopReason: reason } : block
}

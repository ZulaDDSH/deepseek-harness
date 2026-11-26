import {createHash} from 'node:crypto'
import {LlmAdapter, LlmError, resolveRetryPolicy} from '@deepseek-ai/dsh-llm'
import {AcpSession} from './acp-session.js'
import {loadCatalog, projectListModels, projectResolvedModel, resolveWireModel} from './catalog.js'
import {agyCommand} from './command.js'
import {toolsFingerprint} from './mcp-server.js'
import {buildPromptBlocks, buildSystemAppend, extractSystemPrompt, messageFingerprint, nonSystemMessages, prependSystemPrompt, toMcpToolResult} from './prompt.js'

export const name = 'antigravity-cli'
export const inject = ['llm', 'sessions']

const IDLE_TTL_MS = 20 * 60_000
const REAP_INTERVAL_MS = 60_000

function sha256(text) {
  return createHash('sha256').update(text).digest('hex')
}

function prefixMatches(committed, current) {
  if (committed.length === 0 || current.length < committed.length) return false
  for (let i = 0; i < committed.length; i++) {
    if (committed[i] !== current[i]) return false
  }
  return true
}

export function apply(ctx, config = {}) {
  const command = agyCommand(config)
  const sessions = new Map()
  const retryPolicy = resolveRetryPolicy({
    mode: 'normal',
    maxRetries: 2,
    retryableCodes: ['EMPTY_RESPONSE', 'RATE_LIMIT', 'SERVER', 'TIMEOUT', 'TRANSPORT'],
    backoff: {initialDelayMs: 3000, maxDelayMs: 15000},
  }, `${name}.retryPolicy`)

  const attachments = () => {
    try { return ctx.get('attachments') } catch { return undefined }
  }

  async function closeSession(key) {
    const existing = sessions.get(key)
    if (!existing) return
    sessions.delete(key)
    await existing.close()
  }

  const reaper = setInterval(() => {
    const now = Date.now()
    for (const [key, session] of sessions) {
      if (!session.alive || (!session.promptInFlight && !session.pendingTool && now - session.lastActivity > IDLE_TTL_MS)) {
        void closeSession(key)
      }
    }
  }, REAP_INTERVAL_MS)
  reaper.unref?.()

  ctx.effect(() => () => {
    clearInterval(reaper)
    const closing = [...sessions.values()].map(session => session.close())
    sessions.clear()
    return Promise.allSettled(closing)
  }, 'Antigravity ACP sessions')

  class Adapter extends LlmAdapter {
    providerInfo(provider) {
      return {id: provider, name: 'Antigravity CLI'}
    }

    providerRetryPolicy() {
      return retryPolicy
    }

    async listModels(provider) {
      const catalog = await loadCatalog(command)
      return projectListModels(provider, catalog)
    }

    async resolveModel(provider, model, signal) {
      if (signal?.aborted) throw new DOMException('The model request was aborted.', 'AbortError')
      if (!model || typeof model !== 'string' || !/^[\w.-]+$/.test(model) || model.startsWith('-')) {
        throw new LlmError('Choose a valid model listed by Antigravity CLI.', 'UNKNOWN_MODEL')
      }
      const catalog = await loadCatalog(command, {signal}).catch(() => null)
      return projectResolvedModel(provider, model, catalog)
    }

    async *stream(options) {
      if (options.signal?.aborted) {
        yield {type: 'finish', reason: {kind: 'aborted', failure: {code: 'ABORTED', message: 'Request aborted.'}}}
        return
      }
      const model = options.model
      if (!model || typeof model !== 'string' || !/^[\w.-]+$/.test(model) || model.startsWith('-')) {
        throw new LlmError('Choose a model listed by agy models.', 'INVALID_REQUEST')
      }
      const catalog = await loadCatalog(command, {signal: options.signal}).catch(() => null)
      const wireModelId = resolveWireModel(model, options.reasoningEffort, catalog)
      const activeTools = options.purpose !== undefined ? [] : (options.tools ?? []).filter(tool => !tool.deferLoading)
      const harnessSystem = extractSystemPrompt(options)
      const systemAppend = buildSystemAppend(activeTools.length > 0)
      const systemHash = sha256(systemAppend + '\n---\n' + harnessSystem)
      const tHash = toolsFingerprint(activeTools)
      const msgs = nonSystemMessages(options.messages ?? [])
      const fingerprints = msgs.map(messageFingerprint)
      const att = attachments()

      // Stateless / auxiliary requests (Auto Auditor reviews, session titles, compaction summaries, no sessionId)
      if (!options.sessionId || options.purpose !== undefined) {
        const ephemeral = new AcpSession({
          command,
          wireModelId,
          systemAppend,
          tools: activeTools,
          systemHash,
          toolsHash: tHash,
        })
        try {
          await ephemeral.start(options.signal)
          const rawBlocks = await buildPromptBlocks(msgs, {attachments: att, signal: options.signal, isReplay: msgs.length > 1})
          const promptBlocks = prependSystemPrompt(rawBlocks, harnessSystem)
          yield* ephemeral.startTurn(promptBlocks, options.signal)
        } finally {
          await ephemeral.close()
        }
        return
      }

      const key = String(options.sessionId)
      let session = sessions.get(key)

      // Fast path 1: Harness is returning the result for a parked MCP tool call on the live ACP turn!
      const lastMsg = msgs.at(-1)
      if (
        session?.alive &&
        session.pendingTool &&
        session.systemHash === systemHash &&
        session.toolsHash === tHash &&
        lastMsg?.role === 'tool' &&
        lastMsg.toolCallId === session.pendingTool.callId &&
        session.mcp?.isParked(session.pendingTool.callId)
      ) {
        const callId = session.pendingTool.callId
        const mcpResult = await toMcpToolResult(lastMsg, att, options.signal)
        session.committedFingerprints = fingerprints
        try {
          yield* session.continueAfterTool(callId, mcpResult, options.signal)
          return
        } catch (error) {
          // If the live parked turn broke before returning chunks, close it and fall through to clean replay below.
          await closeSession(key)
          if (options.signal?.aborted || error?.code === 'ABORTED') throw error
          session = undefined
        }
      }

      // Fast path 2: Continuing an idle live ACP session with new trailing message(s) (preserves prompt cache!).
      if (
        session?.alive &&
        !session.promptInFlight &&
        !session.pendingTool &&
        session.systemHash === systemHash &&
        session.toolsHash === tHash &&
        prefixMatches(session.committedFingerprints, fingerprints) &&
        fingerprints.length > session.committedFingerprints.length
      ) {
        let deltaMessages = msgs.slice(session.committedFingerprints.length)
        // The live ACP session already holds the assistant reply it just produced at the end of the prior turn.
        if (deltaMessages[0]?.role === 'assistant') {
          deltaMessages = deltaMessages.slice(1)
        }
        if (deltaMessages.length > 0 && deltaMessages.every(msg => msg.role === 'user' || msg.role === 'developer')) {
          if (session.wireModelId !== wireModelId) {
            await session.setModel(wireModelId, options.signal)
          }
          const promptBlocks = await buildPromptBlocks(deltaMessages, {attachments: att, signal: options.signal, isReplay: false})
          session.committedFingerprints = fingerprints
          try {
            yield* session.startTurn(promptBlocks, options.signal)
            return
          } catch (error) {
            await closeSession(key)
            throw error
          }
        }
      }

      // Fresh start or clean rebuild (new chat, history rewind/edit, compaction, tool-list change, or recovered crash).
      if (session) await closeSession(key)
      session = new AcpSession({
        command,
        wireModelId,
        systemAppend,
        tools: activeTools,
        systemHash,
        toolsHash: tHash,
      })
      await session.start(options.signal)
      sessions.set(key, session)
      const rawBlocks = await buildPromptBlocks(msgs, {attachments: att, signal: options.signal, isReplay: msgs.length > 1})
      const promptBlocks = prependSystemPrompt(rawBlocks, harnessSystem)
      session.committedFingerprints = fingerprints
      try {
        yield* session.startTurn(promptBlocks, options.signal)
      } catch (error) {
        await closeSession(key)
        throw error
      }
    }
  }

  ctx.effect(() => ctx.llm.registerAdapter([name], new Adapter()), 'Antigravity CLI provider')
}

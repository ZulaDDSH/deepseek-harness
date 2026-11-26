import {spawn} from 'node:child_process'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {LlmError} from '@deepseek-ai/dsh-llm'
import {recordContextWindow} from './catalog.js'
import {createMcpBridgeServer} from './mcp-server.js'

class AsyncQueue {
  items = []
  waiters = []
  closed = false

  push(item) {
    if (this.closed) return
    const waiter = this.waiters.shift()
    if (waiter) waiter.resolve({value: item, done: false})
    else this.items.push(item)
  }

  close() {
    if (this.closed) return
    this.closed = true
    while (this.waiters.length) {
      this.waiters.shift().resolve({value: undefined, done: true})
    }
  }

  next(signal) {
    if (this.items.length) return Promise.resolve({value: this.items.shift(), done: false})
    if (this.closed) return Promise.resolve({value: undefined, done: true})
    if (signal?.aborted) return Promise.resolve({value: {kind: 'aborted'}, done: false})
    return new Promise(resolve => {
      const waiter = {resolve: result => {
        signal?.removeEventListener('abort', onAbort)
        resolve(result)
      }}
      const onAbort = () => {
        const idx = this.waiters.indexOf(waiter)
        if (idx !== -1) this.waiters.splice(idx, 1)
        resolve({value: {kind: 'aborted'}, done: false})
      }
      signal?.addEventListener('abort', onAbort, {once: true})
      this.waiters.push(waiter)
    })
  }
}

export function classifyAcpError(message, stderr = '') {
  const combined = [message, stderr].filter(Boolean).join('\n')
  if (/not logged in|authentication required|unauthenticated|sign in|oauth/i.test(combined)) {
    return new LlmError('Antigravity needs Google sign-in. Open Settings → Antigravity accounts and sign in.', 'AUTH')
  }
  if (/RESOURCE_EXHAUSTED|quota exceeded|rate limit|\b429\b/i.test(combined)) {
    return new LlmError('Antigravity reported a subscription quota or rate limit.', 'RATE_LIMIT')
  }
  if (/context[\s_-](?:length|window)|too many tokens|prompt is too long/i.test(combined)) {
    return new LlmError('The request exceeded the Antigravity model context window.', 'CONTEXT_WINDOW_EXCEEDED')
  }
  if (/invalid model|not recognized as a known model|unknown model/i.test(combined)) {
    return new LlmError('Antigravity rejected the selected model. Open Settings → Antigravity accounts and refresh models.', 'UNKNOWN_MODEL')
  }
  if (/deadline exceeded|timed out|timeout/i.test(combined)) {
    return new LlmError('Antigravity CLI timed out before completing the turn.', 'TIMEOUT')
  }
  const detail = String(message || stderr || '').trim().slice(0, 320)
  return new LlmError(detail || 'Antigravity CLI ended without a usable answer.', 'SERVER')
}

function mapUsage(raw) {
  if (!raw || typeof raw !== 'object') return null
  const inputTokens = Number.isFinite(raw.inputTokens) ? Math.max(0, Math.floor(raw.inputTokens)) : 0
  const outputTokens = Number.isFinite(raw.outputTokens) ? Math.max(0, Math.floor(raw.outputTokens)) : 0
  const cacheReadTokens = Number.isFinite(raw.cachedReadTokens) ? Math.max(0, Math.floor(raw.cachedReadTokens)) : 0
  const cacheWriteTokens = Number.isFinite(raw.cachedWriteTokens) ? Math.max(0, Math.floor(raw.cachedWriteTokens)) : 0
  const reasoningTokens = Number.isFinite(raw.thoughtTokens) ? Math.max(0, Math.floor(raw.thoughtTokens)) : 0
  const totalTokens = Number.isFinite(raw.totalTokens) ? Math.max(0, Math.floor(raw.totalTokens)) : 0
  return {
    inputTokens,
    outputTokens,
    ...(cacheReadTokens > 0 && {cacheReadTokens}),
    ...(cacheWriteTokens > 0 && {cacheWriteTokens}),
    ...(reasoningTokens > 0 && {reasoningTokens}),
    ...(totalTokens > 0 && {totalTokens}),
  }
}

/**
 * Persistent Antigravity ACP subprocess bound to one empty sandbox temp directory
 * and an authenticated loopback MCP server exposing DeepSeek Harness tools.
 */
export class AcpSession {
  constructor({command, wireModelId, systemAppend, tools, systemHash, toolsHash}) {
    this.command = command
    this.wireModelId = wireModelId
    this.systemAppend = systemAppend
    this.tools = tools
    this.systemHash = systemHash
    this.toolsHash = toolsHash
    this.tempDir = null
    this.mcp = null
    this.child = null
    this.sessionId = null
    this.nextRpcId = 1
    this.pendingRpc = new Map()
    this.stderr = ''
    this.stdoutBuffer = ''
    this.closed = false
    this.activeQueue = null
    this.promptInFlight = false
    this.pendingTool = null
    this.committedFingerprints = []
    this.lastActivity = Date.now()
  }

  get alive() {
    return !this.closed && this.child && this.child.exitCode === null && !this.child.killed
  }

  async start(signal) {
    this.tempDir = await mkdtemp(join(tmpdir(), 'dsh-agy-'))
    if (this.tools.length > 0) {
      this.mcp = await createMcpBridgeServer(this.tools, entry => {
        this.lastActivity = Date.now()
        this.activeQueue?.push({kind: 'tool-call', entry})
      })
    }

    this.child = spawn(
      this.command,
      ['acp', '--stdio', '--disable-telemetry', '--include-default-customizations=false'],
      {cwd: this.tempDir, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']},
    )
    this.child.stdout.setEncoding('utf8')
    this.child.stderr.setEncoding('utf8')
    this.child.stdin.on('error', () => {})
    this.child.stderr.on('data', chunk => {
      this.stderr = (this.stderr + chunk).slice(-32_768)
    })
    this.child.stdout.on('data', chunk => this.onStdout(chunk))
    this.child.on('error', err => this.failAll(classifyAcpError(err.message, this.stderr)))
    this.child.on('close', code => {
      const err = code === 0
        ? new LlmError('Antigravity CLI closed unexpectedly.', 'TRANSPORT')
        : classifyAcpError(`Antigravity CLI exited with code ${code}.`, this.stderr)
      this.failAll(err)
    })

    try {
      await this.rpc('initialize', {protocolVersion: 1, clientCapabilities: {}}, signal, 25_000)
      const sessionParams = {
        cwd: this.tempDir,
        mcpServers: this.mcp ? [this.mcp.mcpConfig] : [],
        ...(this.systemAppend && {_meta: {antigravity: {systemPrompt: {append: this.systemAppend}}}}),
      }
      const created = await this.rpc('session/new', sessionParams, signal, 30_000)
      if (!created?.sessionId) {
        throw classifyAcpError('Antigravity ACP did not return a session ID.', this.stderr)
      }
      this.sessionId = created.sessionId
      if (this.wireModelId && created.models?.currentModelId !== this.wireModelId) {
        await this.setModel(this.wireModelId, signal)
      }
      this.lastActivity = Date.now()
    } catch (error) {
      await this.close()
      throw error instanceof LlmError ? error : classifyAcpError(error?.message, this.stderr)
    }
  }

  async setModel(wireModelId, signal) {
    if (!this.alive || !this.sessionId) throw new LlmError('Antigravity session is closed.', 'TRANSPORT')
    if (this.wireModelId === wireModelId) return
    await this.rpc('session/set_model', {sessionId: this.sessionId, modelId: wireModelId}, signal, 15_000)
    this.wireModelId = wireModelId
    this.lastActivity = Date.now()
  }

  sendRaw(payload) {
    if (!this.alive) return false
    try {
      this.child.stdin.write(JSON.stringify(payload) + '\n')
      return true
    } catch {
      return false
    }
  }

  rpc(method, params, signal, timeoutMs = 0) {
    if (!this.alive) return Promise.reject(new LlmError('Antigravity session is closed.', 'TRANSPORT'))
    const id = this.nextRpcId++
    return new Promise((resolve, reject) => {
      let timer
      const cleanup = () => {
        if (timer) clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        this.pendingRpc.delete(id)
      }
      const onAbort = () => {
        cleanup()
        reject(new LlmError('Request aborted.', 'ABORTED'))
      }
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          cleanup()
          reject(new LlmError(`Antigravity CLI timed out during ${method}.`, 'TIMEOUT'))
        }, timeoutMs)
        timer.unref?.()
      }
      signal?.addEventListener('abort', onAbort, {once: true})
      this.pendingRpc.set(id, {
        resolve: val => { cleanup(); resolve(val) },
        reject: err => { cleanup(); reject(err) },
      })
      if (!this.sendRaw({jsonrpc: '2.0', id, method, params})) {
        cleanup()
        reject(new LlmError('Could not write to Antigravity CLI.', 'TRANSPORT'))
      }
    })
  }

  onStdout(chunk) {
    this.stdoutBuffer += chunk
    const lines = this.stdoutBuffer.split('\n')
    this.stdoutBuffer = lines.pop()
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      let msg
      try { msg = JSON.parse(trimmed) } catch { continue }
      this.handleMessage(msg)
    }
  }

  handleMessage(msg) {
    this.lastActivity = Date.now()
    if (msg.method === 'session/request_permission') {
      const toolName = String(msg.params?.toolCall?.name || '')
      const options = Array.isArray(msg.params?.options) ? msg.params.options : []
      // Only permit Harness MCP tools (`mcp_dsh_*`); deny all native Antigravity tools.
      const allow = this.mcp !== null && toolName.startsWith('mcp_dsh_')
      const chosen = options.find(opt =>
        allow
          ? opt.kind === 'allow_once' || opt.optionId === 'allow'
          : opt.kind === 'reject_once' || opt.optionId === 'deny',
      ) || options[allow ? 0 : options.length - 1]
      if (chosen) {
        this.sendRaw({jsonrpc: '2.0', id: msg.id, result: {outcome: {outcome: 'selected', optionId: chosen.optionId}}})
      }
      return
    }
    if (msg.method === 'session/update') {
      const update = msg.params?.update
      if (!update) return
      if (update.sessionUpdate === 'usage_update' && Number.isFinite(update.size)) {
        recordContextWindow(this.wireModelId, update.size)
      } else if (update.sessionUpdate === 'agent_thought_chunk' && typeof update.content?.text === 'string' && update.content.text) {
        this.activeQueue?.push({kind: 'thought', text: update.content.text})
      } else if (update.sessionUpdate === 'agent_message_chunk' && typeof update.content?.text === 'string' && update.content.text) {
        this.activeQueue?.push({kind: 'text', text: update.content.text})
      }
      return
    }
    if (msg.id !== undefined && this.pendingRpc.has(msg.id)) {
      const pending = this.pendingRpc.get(msg.id)
      if (msg.error) {
        pending.reject(classifyAcpError(msg.error.message || JSON.stringify(msg.error), this.stderr))
      } else {
        pending.resolve(msg.result)
      }
    }
  }

  failAll(error) {
    if (this.closed) return
    this.closed = true
    for (const pending of this.pendingRpc.values()) {
      pending.reject(error)
    }
    this.pendingRpc.clear()
    this.activeQueue?.push({kind: 'error', error})
    this.activeQueue?.close()
    this.promptInFlight = false
    this.pendingTool = null
  }

  cancelTurn() {
    if (!this.alive || !this.sessionId) return
    this.sendRaw({jsonrpc: '2.0', method: 'session/cancel', params: {sessionId: this.sessionId}})
  }

  /** Start a new `session/prompt` turn and stream until a parked MCP tool call or turn completion. */
  async *startTurn(promptBlocks, signal) {
    if (!this.alive) throw new LlmError('Antigravity session is no longer running.', 'TRANSPORT')
    if (this.promptInFlight) throw new LlmError('Antigravity session already has an active turn.', 'INVALID_REQUEST')
    const queue = new AsyncQueue()
    this.activeQueue = queue
    this.promptInFlight = true
    this.pendingTool = null

    this.rpc('session/prompt', {sessionId: this.sessionId, prompt: promptBlocks}, undefined, 0).then(
      result => {
        queue.push({kind: 'turn-end', stopReason: result?.stopReason || 'end_turn', usage: result?.usage})
        queue.close()
      },
      error => {
        queue.push({kind: 'error', error: error instanceof LlmError ? error : classifyAcpError(error?.message, this.stderr)})
        queue.close()
      },
    )

    yield* this.consumeUntilBoundary(queue, signal)
  }

  /** Deliver a Harness tool result to the parked MCP call and resume the live ACP turn. */
  async *continueAfterTool(callId, mcpResult, signal) {
    if (!this.alive || !this.promptInFlight || !this.pendingTool || this.pendingTool.callId !== callId) {
      throw new LlmError('Parked Antigravity tool call is no longer active.', 'TRANSPORT')
    }
    const queue = this.activeQueue
    this.pendingTool = null
    if (!this.mcp?.answer(callId, mcpResult)) {
      throw new LlmError('Antigravity closed the tool call before Harness answered.', 'TRANSPORT')
    }
    yield* this.consumeUntilBoundary(queue, signal)
  }

  async *consumeUntilBoundary(queue, signal) {
    let blockIndex = 0
    let openBlock = null
    let emittedAnyContent = false

    const closeOpenBlock = () => {
      if (!openBlock) return null
      const ended = openBlock
      openBlock = null
      return {type: 'block-end', index: ended.index, block: {type: ended.type, text: ended.text}}
    }

    while (true) {
      const {value: ev, done} = await queue.next(signal)
      if (done) {
        const endChunk = closeOpenBlock()
        if (endChunk) yield endChunk
        this.promptInFlight = false
        this.activeQueue = null
        if (!emittedAnyContent) {
          throw new LlmError('Antigravity finished without returning any answer text.', 'EMPTY_RESPONSE')
        }
        yield {type: 'finish', reason: {kind: 'stop'}}
        return
      }
      if (ev.kind === 'aborted') {
        const endChunk = closeOpenBlock()
        if (endChunk) yield endChunk
        this.cancelTurn()
        await this.close()
        yield {type: 'finish', reason: {kind: 'aborted', failure: {code: 'ABORTED', message: 'Request aborted.'}}}
        return
      }
      if (ev.kind === 'error') {
        const endChunk = closeOpenBlock()
        if (endChunk) yield endChunk
        this.promptInFlight = false
        this.activeQueue = null
        this.pendingTool = null
        throw ev.error
      }
      if (ev.kind === 'thought') {
        if (openBlock && openBlock.type !== 'reasoning') {
          yield closeOpenBlock()
        }
        if (!openBlock) {
          openBlock = {type: 'reasoning', index: blockIndex++, text: ''}
          yield {type: 'block-start', index: openBlock.index, blockType: 'reasoning'}
        }
        openBlock.text += ev.text
        emittedAnyContent = true
        yield {type: 'reasoning-delta', index: openBlock.index, text: ev.text}
        continue
      }
      if (ev.kind === 'text') {
        if (openBlock && openBlock.type !== 'text') {
          yield closeOpenBlock()
        }
        if (!openBlock) {
          openBlock = {type: 'text', index: blockIndex++, text: ''}
          yield {type: 'block-start', index: openBlock.index, blockType: 'text'}
        }
        openBlock.text += ev.text
        emittedAnyContent = true
        yield {type: 'text-delta', index: openBlock.index, text: ev.text}
        continue
      }
      if (ev.kind === 'tool-call') {
        const endChunk = closeOpenBlock()
        if (endChunk) yield endChunk
        this.pendingTool = ev.entry
        emittedAnyContent = true
        yield {
          type: 'block-end',
          index: blockIndex++,
          block: {type: 'tool-call', id: ev.entry.callId, name: ev.entry.dshName, arguments: ev.entry.argumentsJson},
        }
        yield {type: 'finish', reason: {kind: 'tool-calls'}}
        return
      }
      if (ev.kind === 'turn-end') {
        const endChunk = closeOpenBlock()
        if (endChunk) yield endChunk
        this.promptInFlight = false
        this.activeQueue = null
        this.pendingTool = null
        const usage = mapUsage(ev.usage)
        if (usage) yield {type: 'usage', usage}
        if (ev.stopReason === 'cancelled') {
          yield {type: 'finish', reason: {kind: 'aborted', failure: {code: 'ABORTED', message: 'Antigravity turn cancelled.'}}}
          return
        }
        if (!emittedAnyContent) {
          throw new LlmError('Antigravity finished without returning any answer text.', 'EMPTY_RESPONSE')
        }
        yield {type: 'finish', reason: {kind: ev.stopReason === 'max_tokens' ? 'max-tokens' : 'stop'}}
        return
      }
    }
  }

  async close() {
    this.closed = true
    this.promptInFlight = false
    this.pendingTool = null
    this.activeQueue?.close()
    this.activeQueue = null
    for (const pending of this.pendingRpc.values()) {
      pending.reject(new LlmError('Antigravity session closed.', 'TRANSPORT'))
    }
    this.pendingRpc.clear()
    if (this.mcp) {
      const mcp = this.mcp
      this.mcp = null
      await mcp.close().catch(() => {})
    }
    if (this.child) {
      const child = this.child
      this.child = null
      try { child.kill() } catch {}
    }
    if (this.tempDir) {
      const dir = this.tempDir
      this.tempDir = null
      await rm(dir, {recursive: true, force: true}).catch(() => {})
    }
  }
}

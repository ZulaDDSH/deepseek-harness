import { randomUUID } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { realpathNormalize } from '@deepseek-ai/dsh-workspace'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { createAssistantMessage, createSystemMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { ApiSessionAgentController } from './agent.ts'
import type { SessionCommandController } from './commands.ts'
import { ExternalChats, type ExternalTranscript } from './external-chats.ts'
import type { ExternalChatImportResult, ExternalChatImportValue, ExternalChatKey, SessionCreateValue } from './types.ts'

/**
 * Encode imported text as balanced native session events.
 * @param id - destination session identity.
 * @param transcript - supported user and assistant messages.
 * @param source - label for imported assistant model metadata.
 * @returns replayable events with a protected system-message position.
 */
export function externalHistory(id: SessionId, transcript: ExternalTranscript, source: string): readonly SessionEvent[] {
  const seed = Session.create(id)
  const events: SessionEvent[] = []
  for (const [index, message] of transcript.messages.entries()) {
    const turn = index + 1
    events.push(seed.append('turn/start', { turn }))
    events.push(seed.append('step/start', { turn, step: 1 }))
    if (index === 0) events.push(seed.append('system/message', { turn, step: 1, message: createSystemMessage('') }, { surfaceOp: 'append' }))
    const content = [{ type: 'text' as const, text: message.text }]
    if (message.role === 'user') events.push(seed.append('user/message', createUserMessage({ content, source: { kind: 'user' } }), { surfaceOp: 'append' }))
    else events.push(seed.append('assistant/message', { turn, step: 1,
      message: createAssistantMessage({ content, source: { provider: `imported-${source}`, model: 'text-history' } }),
      stream: [
        { type: 'chunk', time: 0, chunk: { type: 'block-start', index: 0, blockType: 'text' } },
        { type: 'text-chunks', time0: 0, index: 0, dt: [], texts: [message.text] },
        { type: 'chunk', time: 0, chunk: { type: 'block-end', index: 0, block: { type: 'text', text: message.text } } },
        { type: 'chunk', time: 0, chunk: { type: 'finish', reason: { kind: 'stop' } } },
      ],
    }, { surfaceOp: 'append' }))
    events.push(seed.append('step/end', { turn, step: 1 }))
    events.push(seed.append('turn/end', { turn, reason: { kind: 'completed' } }))
  }
  return events
}

/** Host ownership of the dedicated master home and durable text imports. */
export class MasterControlSessions {
  /** Instance-local discovery and reading of external transcript files. */
  readonly external: ExternalChats
  private home: Promise<SessionCreateValue> | undefined
  private imports: Promise<unknown> = Promise.resolve()

  constructor(private readonly ctx: Context, private readonly agents: ApiSessionAgentController,
    private readonly commands: SessionCommandController, external = new ExternalChats()) {
    this.external = external
  }

  /**
   * Resolve or create the dedicated home, sharing concurrent requests.
   * @returns the durable ungrouped master session identity.
   */
  openHome(): Promise<SessionCreateValue> {
    if (this.home !== undefined) return this.home
    const operation = this.resolveHome()
    this.home = operation
    void operation.finally(() => { if (this.home === operation) this.home = undefined }).catch(() => {})
    return operation
  }

  private async resolveHome(): Promise<SessionCreateValue> {
    const records = await this.ctx.sessionQuery.listSessions()
    const archived = this.ctx.workspaceRegistry.archivedSessionIds
    const existing = records.find(({ header }) => header.id.startsWith('master-control-home-')
      && header.agentPreset === 'master' && !archived.includes(header.id)
      && !this.ctx.workspaceRegistry.list().some(workspace => workspace.sessionIds.includes(header.id)))
    const result = await this.commands.createMasterHome(existing?.header.id ?? SessionId(`master-control-home-${randomUUID()}`))
    await this.commands.rename({ sessionId: result.sessionId, title: 'Master Control' })
    const session = this.ctx.sessions.get(result.sessionId)
    if (session === undefined) throw new Error('Master Control session is unavailable')
    if (!await this.ctx.sessions.flush(session)) throw new Error('Session persistence is unavailable')
    return result
  }

  /**
   * Serialize imports with duplicate protection and per-key failures.
   * @param keys - up to 100 identities returned by discovery.
   * @returns outcomes after successful sessions reach durable storage.
   */
  importChats(keys: readonly ExternalChatKey[]): Promise<ExternalChatImportValue> {
    if (keys.length > 100) return Promise.reject(new Error('Select at most 100 chats'))
    const operation = this.imports.then(async () => {
      const items: ExternalChatImportResult[] = []
      for (const key of new Set(keys)) {
        try { items.push(await this.importOne(key)) } catch (error) {
          items.push({ key, error: error instanceof Error ? error.message : String(error) })
        }
      }
      return { items }
    })
    this.imports = operation.catch(() => {})
    return operation
  }

  private async importOne(key: ExternalChatKey): Promise<ExternalChatImportResult> {
    if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid external chat key')
    const sessionId = SessionId(`imported-chat-${key}`)
    const existing = (await this.ctx.sessionQuery.listSessions()).find(row => row.header.id === sessionId)
    if (existing !== undefined) {
      const live = this.ctx.sessions.get(sessionId)
      if (live !== undefined) {
        if (this.ctx.get('sessionTitle')?.get(live) === undefined) {
          const transcript = await this.external.read(key)
          await this.commands.rename({ sessionId, title: `[Imported] ${transcript.title}` })
        }
        if (!await this.ctx.sessions.flush(live)) throw new Error('Session persistence is unavailable')
      }
      return { key, sessionId, duplicate: true }
    }
    const transcript = await this.external.read(key)
    const composition = await this.agents.composeAgent('standard')
    const seed = externalHistory(sessionId, transcript, 'external')
    const cwd = await realpathNormalize(transcript.cwd ?? homedir())
    if (!(await stat(cwd)).isDirectory()) throw new Error('The source project path is not a directory')
    const titles = this.ctx.get('sessionTitle')
    if (titles === undefined) throw new Error('Session titles are unavailable')

    const { provider, model } = this.ctx.agentDefaultModel.currentSelection()
    const { agent } = await this.ctx.agents.create({ sessionId, seed,
      meta: { cwd, agentPreset: 'standard' }, agentOptions: { provider, model }, setup: composition.setup })
    await this.commands.rename({ sessionId, title: `[Imported] ${transcript.title}` })
    const workspace = transcript.cwd === undefined ? undefined : this.ctx.workspaceRegistry.list()
      .find(item => resolve(item.path) === resolve(cwd))
    if (workspace !== undefined) await workspace.attachSession(sessionId)
    if (!await this.ctx.sessions.flush(agent.session)) throw new Error('Session persistence is unavailable')
    return { key, sessionId }
  }
}

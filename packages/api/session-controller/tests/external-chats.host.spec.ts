import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ExternalChats, parseExternalTranscript } from '../src/external-chats.ts'
import { externalHistory } from '../src/master-control.ts'
import { Session, SessionId } from '@deepseek-ai/dsh-session'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
const jsonl = (...records: unknown[]) => records.map(row => JSON.stringify(row)).join('\n') + '\n'

describe('external text transcripts', () => {
  it('keeps Codex user/assistant text once and excludes instructions, tools, images, and event echoes', () => {
    const user = { type: 'response_item', payload: { type: 'message', id: 'u', role: 'user', content: [{ type: 'input_text', text: 'Question' }, { type: 'image', text: 'not text' }] } }
    const parsed = parseExternalTranscript('codex', jsonl(
      { type: 'session_meta', payload: { cwd: process.cwd() } },
      { type: 'response_item', payload: { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'secret instructions' }] } },
      user, user,
      { type: 'event_msg', payload: { type: 'user_message', message: 'echo' } },
      { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Answer' }] } },
    ))
    expect(parsed.messages).toEqual([{ role: 'user', text: 'Question' }, { role: 'assistant', text: 'Answer' }])
    const events = externalHistory(SessionId('import-history-test'), parsed, 'codex')
    const session = Session.create(SessionId('import-history-test'), events)
    expect(session.deriveMessages().map(m => [m.role, m.content])).toEqual([
      ['user', [{ type: 'text', text: 'Question' }]], ['assistant', [{ type: 'text', text: 'Answer' }]],
    ])
    expect(events.at(-1)).toMatchObject({ type: 'session/end-seed' })
  })

  it('reads Claude string and block messages, title and cwd, excluding sidechains and tool results', () => {
    const parsed = parseExternalTranscript('claude', jsonl(
      { type: 'user', uuid: 'u', cwd: process.cwd(), message: { role: 'user', content: 'Hello' } },
      { type: 'assistant', uuid: 'a', message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'private' }, { type: 'text', text: 'Hi' }] } },
      { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'tool output' }] } },
      { type: 'assistant', isSidechain: true, message: { role: 'assistant', content: 'worker' } },
      { type: 'custom-title', customTitle: 'Greeting' },
    ))
    expect(parsed).toEqual({ cwd: process.cwd(), title: 'Greeting', messages: [{ role: 'user', text: 'Hello' }, { role: 'assistant', text: 'Hi' }] })
  })

  it.each(['{"broken":', '{"broken":\n'])('rejects a malformed final record rather than importing a prefix', (tail) => {
    expect(() => parseExternalTranscript('claude', jsonl({ type: 'user', message: { role: 'user', content: 'Hello' } }) + tail)).toThrow('Invalid JSON')
  })

  it('imports the active Claude parent chain without mixing abandoned replies', () => {
    const parsed = parseExternalTranscript('claude', jsonl(
      { type: 'user', uuid: 'u', parentUuid: null, message: { role: 'user', content: 'Hello' } },
      { type: 'assistant', uuid: 'old', parentUuid: 'u', message: { role: 'assistant', content: 'Abandoned reply' } },
      { type: 'assistant', uuid: 'new', parentUuid: 'u', message: { role: 'assistant', content: 'Current reply' } },
    ))
    expect(parsed.messages.map(message => message.text)).toEqual(['Hello', 'Current reply'])
  })

  it('discovers valid and invalid rows independently and refuses paths supplied as keys', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-external-'))
    roots.push(root)
    const claude = join(root, 'claude')
    const codex = join(root, 'codex')
    await mkdir(join(claude, 'project'), { recursive: true })
    await mkdir(codex)
    await writeFile(join(claude, 'project', 'good.jsonl'), jsonl({ type: 'user', message: { role: 'user', content: 'Hello' } }))
    await writeFile(join(codex, 'bad.jsonl'), 'broken\n')
    const chats = new ExternalChats({ claude, codex })
    const catalog = await chats.discover()
    expect(catalog.items).toHaveLength(2)
    expect(catalog.items.filter(item => item.error !== undefined)).toHaveLength(1)
    const good = catalog.items.find(item => item.error === undefined)!
    expect((await chats.read(good.key)).messages[0]?.text).toBe('Hello')
    expect((await chats.discover()).items.find(item => item.error === undefined)?.key).toBe(good.key)
    await expect(chats.read(join(claude, 'project', 'good.jsonl'))).rejects.toThrow('no longer in the discovery list')
  })
})

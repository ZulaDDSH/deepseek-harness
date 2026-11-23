import { describe, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import { createAssistantMessage, createToolResultMessage, createUserMessage, type ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, ImageBlock } from '@deepseek-ai/dsh-llm'
import { deriveEventMessage, foldSurface, Session, type SessionId, SessionLogOffset, SessionSeq } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionEventMap } from '@deepseek-ai/dsh-session'
import { imageOffloadProjection, imageRestoreProjection } from '../src/projection.ts'

function createSession(...args: Parameters<typeof Session.create>): Session {
  args[4] = [imageOffloadProjection, imageRestoreProjection]
  return Session.create(...args)
}

const image: ImageBlock = {
  type: 'image',
  attachment: { attachmentId: `sha256:${'a'.repeat(64)}` as never, mediaType: 'image/png', bytes: 1, width: 1, height: 1 },
}

function input(session: Session, content: ContentBlock[] = [image, image]) {
  return session.append('user/message', createUserMessage({ content, source: { kind: 'user' } }), { surfaceOp: 'append' })
}

function marked(session: Session): boolean[] {
  const result: boolean[] = []
  for (const message of session.deriveMessages()) {
    for (const block of message.content) {
      if (block.type === 'image') result.push(block.offloaded === true)
    }
  }
  return result
}

describe('durable image selections', () => {
  it('preserves message identity, original data, and previously derived snapshots', () => {
    const session = createSession(brandString<SessionId>('images'))
    const source = input(session, [
      { type: 'text', text: 'before' }, image,
      image, { type: 'text', text: 'after' },
      { type: 'text', text: 'unchanged' },
      image,
    ])
    const before = session.deriveMessages()
    session.append('image/offload', { targets: [{ seq: source.seq, imageIndexes: [1] }] })
    expect(marked(session)).toEqual([false, true, false])
    const after = session.deriveMessages()
    expect(after[0]?.id).toBe(before[0]?.id)
    expect(after[0]).toBe(session.deriveEventMessage(source))
    expect(Object.isFrozen(after[0])).toBe(true)
    expect(Object.isFrozen(after[0]?.content)).toBe(true)
    expect(after[0]?.content[0]).toBe(before[0]?.content[0])
    expect(after[0]?.content[3]).toBe(before[0]?.content[3])
    expect(JSON.stringify(source)).not.toContain('offloaded')
    expect(JSON.stringify(before)).not.toContain('offloaded')
    expect(session.surface.nodes).toEqual([source.seq])
    expect(session.surface.replaceGeneration).toBe(0)
    expect(session.surface.contentGeneration).toBe(1)
    expect(session.deriveEventMessage(session.snapshotEvents().at(-1)!)).toBeNull()
    session.append('image/offload', { targets: [{ seq: source.seq, imageIndexes: [0, 2] }] })
    expect(marked(session)).toEqual([true, true, true])
    expect(session.surface.contentGeneration).toBe(2)
    expect(after[0]).not.toBe(session.deriveMessages()[0])
  })

  it('reconstructs the same selections through pure folding, resume, restore, and fork', () => {
    const session = createSession(brandString<SessionId>('source'))
    const source = input(session)
    const before = session.snapshotEvents()
    session.append('image/offload', { targets: [{ seq: source.seq, imageIndexes: [0] }] })
    const events = session.snapshotEvents()
    const fold = foldSurface(events, [imageOffloadProjection])
    expect(deriveEventMessage(source, fold.projectedMessages)).toEqual(session.deriveMessages()[0])
    expect(marked(createSession(brandString<SessionId>('before'), before))).toEqual([false, false])
    expect(marked(createSession(brandString<SessionId>('resume'), events))).toEqual([true, false])
    const restored = Session.fromRestore(session.id, events, session.header, SessionLogOffset(0), 'shared-frozen', [imageOffloadProjection])
    expect(marked(restored)).toEqual([true, false])
    const childId = brandString<SessionId>('child')
    const child = createSession(childId, events, {
      ...session.header, id: childId, parentSession: session.id, isSeeded: true,
    }, SessionLogOffset(events.length))
    expect(marked(child)).toEqual([true, false])
    input(child, [image])
    expect(marked(child)).toEqual([true, false, false])
    expect(marked(session)).toEqual([true, false])
  })

  it('counts all images in a tool result without changing its call identity', () => {
    const session = createSession(brandString<SessionId>('tool'))
    const source = session.append('tool/result', {
      turn: 1, step: 1,
      message: createToolResultMessage({ callId: brandString<ToolCallId>('shot'), isError: false, content: [image, image] }),
    }, { surfaceOp: 'append' })
    session.append('image/offload', { targets: [{ seq: source.seq, imageIndexes: [1] }] })
    expect(marked(session)).toEqual([false, true])
    expect(session.deriveEventMessage(source)?.source).toEqual(source.data.message.source)
  })

  it.each([
    null, {}, { targets: [] }, { targets: 'bad' }, { targets: [null] },
    { targets: [{ seq: 0, imageIndexes: [] }] },
    { targets: [{ seq: 0, imageIndexes: [0], extra: true }] },
    { targets: [{ seq: 0, imageIndexes: [0] }], extra: true },
    { targets: [{ seq: -1, imageIndexes: [0] }] },
    { targets: [{ seq: 0, imageIndexes: [-1] }] },
    { targets: [{ seq: 0, imageIndexes: [0.5] }] },
    { targets: [{ seq: 0, imageIndexes: ['0'] }] },
    { targets: [{ seq: 0, imageIndexes: [1, 0] }] },
    { targets: [{ seq: 0, imageIndexes: [0, 0] }] },
    { targets: [{ seq: 0, imageIndexes: [2] }] },
    { targets: [{ seq: 1, imageIndexes: [0] }] },
    { targets: [{ seq: 0, imageIndexes: [0] }, { seq: 0, imageIndexes: [1] }] },
  ])('rejects malformed selections at append and replay without partial application: %j', (data) => {
    const session = createSession(brandString<SessionId>('invalid'))
    input(session)
    const events = session.snapshotEvents()
    const candidate = { type: 'image/offload', seq: SessionSeq(1), time: 0, data } as SessionEvent
    expect(() => session.append('image/offload', data as SessionEventMap['image/offload'])).toThrow(/image\/offload/)
    expect(() => createSession(brandString<SessionId>('seed'), [...events, candidate])).toThrow(/image\/offload/)
    expect(() => foldSurface([...events, candidate], [imageOffloadProjection])).toThrow(/image\/offload/)
    expect(session.snapshotEvents()).toEqual(events)
    expect(marked(session)).toEqual([false, false])
    expect(session.surface.contentGeneration).toBe(0)
    session.append('image/offload', { targets: [{ seq: SessionSeq(0), imageIndexes: [1] }] })
    expect(marked(session)).toEqual([false, true])
  })

  it('rejects repeated offloads and shadowed or assistant targets', () => {
    const session = createSession(brandString<SessionId>('invalid-targets'))
    const source = input(session)
    session.append('image/offload', { targets: [{ seq: source.seq, imageIndexes: [0] }] })
    expect(() => session.append('image/offload', { targets: [{ seq: source.seq, imageIndexes: [0] }] })).toThrow(/already offloaded/)
    session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'summary' }], source: { kind: 'user' } }), {
      surfaceOp: { op: 'replace', startSeq: source.seq, endSeq: source.seq }, sourceEventSeqs: [source.seq],
    })
    expect(() => session.append('image/offload', { targets: [{ seq: source.seq, imageIndexes: [1] }] })).toThrow(/not a current/)
    const assistant = session.append('assistant/message', {
      turn: 1, step: 1, stream: [],
      message: createAssistantMessage({ content: [image], source: { provider: 'mock', model: 'mock' } }),
    }, { surfaceOp: 'append' })
    expect(() => session.append('image/offload', { targets: [{ seq: assistant.seq, imageIndexes: [0] }] })).toThrow(/must be user\/message/)
  })
})

describe('durable image restore', () => {
  it('clears only the selected marks, keeps identity, and replays through resume, restore, and fork', () => {
    const session = createSession(brandString<SessionId>('restore'))
    const source = input(session, [image, { type: 'text', text: 'between' }, image, image])
    const plain = session.deriveMessages()
    session.append('image/offload', { targets: [{ seq: source.seq, imageIndexes: [0, 1, 2] }] })
    expect(marked(session)).toEqual([true, true, true])
    const offloaded = session.deriveMessages()
    session.append('image/restore', { targets: [{ seq: source.seq, imageIndexes: [0, 2] }] })
    expect(marked(session)).toEqual([false, true, false])
    const restored = session.deriveMessages()
    expect(restored[0]?.id).toBe(plain[0]?.id)
    expect(JSON.stringify(restored)).not.toContain('"offloaded":false')
    expect(Object.isFrozen(restored[0]?.content)).toBe(true)
    expect(offloaded[0]?.content[2]).toEqual({ ...image, offloaded: true })
    expect(restored[0]?.content[1]).toBe(plain[0]?.content[1])
    expect(restored[0]?.content[2]).toBe(offloaded[0]?.content[2])
    expect(restored[0]?.content[3]).not.toHaveProperty('offloaded')
    expect(session.surface.contentGeneration).toBe(2)
    const events = session.snapshotEvents()
    const fold = foldSurface(events, [imageOffloadProjection, imageRestoreProjection])
    expect(deriveEventMessage(source, fold.projectedMessages)).toEqual(restored[0])
    expect(marked(createSession(brandString<SessionId>('resume'), events))).toEqual([false, true, false])
    const rebuilt = Session.fromRestore(session.id, events, session.header, SessionLogOffset(0), 'shared-frozen', [imageOffloadProjection, imageRestoreProjection])
    expect(marked(rebuilt)).toEqual([false, true, false])
    session.append('image/offload', { targets: [{ seq: source.seq, imageIndexes: [0] }] })
    expect(marked(session)).toEqual([true, true, false])
  })

  it('requires the restore interpreter to replay a restore event', () => {
    const session = createSession(brandString<SessionId>('restore-missing'))
    const source = input(session)
    session.append('image/offload', { targets: [{ seq: source.seq, imageIndexes: [0] }] })
    session.append('image/restore', { targets: [{ seq: source.seq, imageIndexes: [0] }] })
    expect(() => foldSurface(session.snapshotEvents(), [imageOffloadProjection])).toThrow(/requires a message projection/)
  })

  it.each([
    [{ targets: [{ seq: 0, imageIndexes: [0] }] }, /not offloaded/],
    [{ targets: [{ seq: 0, imageIndexes: [2] }] }, /image index 2 does not exist/],
    [{ targets: [] }, /image\/restore: data must contain/],
    [{ targets: [{ seq: 0, imageIndexes: [] }] }, /image\/restore: each target/],
    [{ targets: [{ seq: 1, imageIndexes: [0] }] }, /not a current surface node/],
    [{ targets: [{ seq: 0, imageIndexes: [1, 0] }] }, /strictly increasing/],
  ])('rejects invalid restores at append and replay without partial application: %j', (data, message) => {
    const session = createSession(brandString<SessionId>('restore-invalid'))
    input(session)
    const events = session.snapshotEvents()
    const candidate = { type: 'image/restore', seq: SessionSeq(1), time: 0, data } as SessionEvent
    expect(() => session.append('image/restore', data as SessionEventMap['image/restore'])).toThrow(message)
    expect(() => foldSurface([...events, candidate], [imageOffloadProjection, imageRestoreProjection])).toThrow(message)
    expect(session.snapshotEvents()).toEqual(events)
    expect(marked(session)).toEqual([false, false])
  })

  it('rejects restoring an occurrence twice', () => {
    const session = createSession(brandString<SessionId>('restore-twice'))
    const source = input(session)
    session.append('image/offload', { targets: [{ seq: source.seq, imageIndexes: [1] }] })
    session.append('image/restore', { targets: [{ seq: source.seq, imageIndexes: [1] }] })
    expect(() => session.append('image/restore', { targets: [{ seq: source.seq, imageIndexes: [1] }] })).toThrow(/not offloaded/)
  })
})

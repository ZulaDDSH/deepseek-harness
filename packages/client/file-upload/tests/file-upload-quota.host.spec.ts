import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { FileAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import FileUploads from '../src/index.ts'

async function harness(fileBytes: number) {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  const session = { header: { origin: 'user' } }
  const agent = { id: 's1', session } as unknown as Agent
  ctx.provide('agents', { get: () => agent } as never)
  ctx.provide('commands', { registerFileReceiptResolver: () => () => {} } as never)
  ctx.provide('connection', { fetch: { register: () => () => {} } } as never)
  const saveFile = vi.fn(async (): Promise<FileAttachmentRef> => ({
    attachmentId: `sha256:${'ab'.repeat(32)}` as never, name: 'f', bytes: fileBytes,
  }))
  ctx.provide('attachments', { saveFile, isAttachmentError: () => false, admitEncodedFile: saveFile } as never)
  const uploads = new FileUploads(ctx)
  return { uploads, agent, saveFile }
}

const upload = (uploads: FileUploads, agent: Agent, data = '') =>
  uploads.upload(agent, { data }, new AbortController().signal)

describe('FileUploads per-Session staging quota', () => {
  it('refuses another upload once a Session holds the maximum number of unsent receipts', async () => {
    const { uploads, agent, saveFile } = await harness(1)
    for (let i = 0; i < 100; i += 1) await upload(uploads, agent)
    await expect(upload(uploads, agent)).rejects.toMatchObject({ details: { reason: 'TOO_MANY_STAGED_FILES' } })
    expect(saveFile).toHaveBeenCalledTimes(100)
  })

  it('expires abandoned receipts after a day but keeps prompt-bound ones', async () => {
    const { uploads, agent } = await harness(1)
    const now = vi.spyOn(Date, 'now')
    now.mockReturnValue(1_000_000)
    const bound = await upload(uploads, agent)
    for (let i = 1; i < 100; i += 1) await upload(uploads, agent)
    uploads.bindPrompt(agent, [bound.receiptId], 'req-1').commit()
    await expect(upload(uploads, agent)).rejects.toMatchObject({ details: { reason: 'TOO_MANY_STAGED_FILES' } })
    now.mockReturnValue(1_000_000 + 25 * 60 * 60 * 1000)
    const fresh = await upload(uploads, agent)
    expect(uploads.resolve(agent, fresh.receiptId)).toBeDefined()
    expect(uploads.resolve(agent, bound.receiptId)).toBeDefined()
  })

  it('refuses a stage whose bytes would pass the Session byte cap and refuses storing once over it', async () => {
    const { uploads, agent, saveFile } = await harness(3 * 1024 ** 3)
    await upload(uploads, agent)
    await expect(upload(uploads, agent)).rejects.toMatchObject({ details: { reason: 'STAGED_FILES_TOO_LARGE' } })
    expect(saveFile).toHaveBeenCalledTimes(2)
  })

  it('refuses an encoded upload that cannot fit before storing it', async () => {
    const { uploads, agent, saveFile } = await harness(4 * 1024 ** 3 - 100)
    await upload(uploads, agent)
    await expect(upload(uploads, agent, 'A'.repeat(400))).rejects.toMatchObject({ details: { reason: 'STAGED_FILES_TOO_LARGE' } })
    expect(saveFile).toHaveBeenCalledTimes(1)
  })
})

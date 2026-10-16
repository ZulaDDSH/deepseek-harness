import { afterEach, describe, expect, it } from 'vitest'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { adapter, chunks, options, server } from './helpers.ts'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!()
})

async function sentBody(reasoningEffort?: string): Promise<Record<string, unknown> | undefined> {
  const http = await server()
  cleanup.push(() => http.close())
  const llm = adapter({ baseURL: http.url })
  await chunks(llm.stream(options({ ...reasoningEffort === undefined ? {} : { reasoningEffort: ReasoningEffortId(reasoningEffort) } })))
  return http.requests[0]?.body
}

describe('native DeepSeek Messages reasoning effort', () => {
  it('sends the documented default high as thinking enabled with output_config high', async () => {
    expect(await sentBody()).toMatchObject({ thinking: { type: 'enabled' }, output_config: { effort: 'high' } })
  })

  it.each(['low', 'high', 'max'])('sends %s as output_config effort', async (level) => {
    expect(await sentBody(level)).toMatchObject({ thinking: { type: 'enabled' }, output_config: { effort: level } })
  })

  it('sends off as thinking disabled with no effort field', async () => {
    const body = await sentBody('off')
    expect(body).toMatchObject({ thinking: { type: 'disabled' } })
    expect(body).not.toHaveProperty('output_config')
  })

  it('refuses medium before any request, since DeepSeek maps it to high', async () => {
    const http = await server()
    cleanup.push(() => http.close())
    const llm = adapter({ baseURL: http.url })
    await expect(chunks(llm.stream(options({ reasoningEffort: ReasoningEffortId('medium') })))).rejects.toMatchObject({
      code: 'UNSUPPORTED_REASONING_EFFORT',
    })
    expect(http.requests).toHaveLength(0)
  })
})

import type { McpHumanOperations } from '@deepseek-ai/dsh-mcp-client'
import { describe, expect, it } from 'vitest'
import { callMemorix, storeObservation } from '../src/store.ts'

const LEAKED = 'resolved-marker-value'

function provider(text: string, isError: boolean): McpHumanOperations {
  return {
    local: true, cwd: '', env: {},
    call: async () => ({ ...isError ? { isError } : {}, content: [{ type: 'text', text }] }),
    redact: value => value.replaceAll(LEAKED, '[redacted]'),
  }
}

describe('Memorix diagnostics', () => {
  it('redacts resolved secrets from an error result excerpt', async () => {
    const failure = callMemorix(provider(`denied ${LEAKED}`, true), 'memorix_store', {}, new AbortController().signal, 'document chunk')
    await expect(failure).rejects.toThrow('Memorix rejected this document chunk: denied [redacted]')
  })

  it('redacts resolved secrets from an unrecognized acknowledgement excerpt', async () => {
    const failure = storeObservation(provider(`odd reply ${LEAKED}`, false), {}, new AbortController().signal, 'document chunk')
    await expect(failure).rejects.toThrow('Memorix did not persist the complete document chunk: odd reply [redacted]')
  })

  it('redacts a secret that would straddle the excerpt limit', async () => {
    const failure = await callMemorix(provider(`${'x'.repeat(295)}${LEAKED}`, true), 'memorix_store', {}, new AbortController().signal, 'chunk').catch((error: unknown) => String(error))
    expect(failure).not.toContain(LEAKED.slice(0, 5))
  })

  it('keeps the excerpt unchanged without a redactor', async () => {
    const plain: McpHumanOperations = { local: true, cwd: '', env: {}, call: async () => ({ isError: true, content: [{ type: 'text', text: 'denied plain' }] }) }
    await expect(callMemorix(plain, 'memorix_store', {}, new AbortController().signal, 'chunk')).rejects.toThrow('Memorix rejected this chunk: denied plain')
  })
})

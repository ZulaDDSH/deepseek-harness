// @vitest-environment jsdom
import type { ChatSnapshot, UseChat } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { PartialArguments } from '@deepseek-ai/dsh-util-values'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ApprovalCommand, approvalDetail } from '../src/client/chat/ApprovalCommand.tsx'

function props(
  nodes: readonly unknown[],
  callId = 'call-1',
): PropsRuntime<'conversation.approval.detail'> {
  const snapshot = {
    nodes: { values: () => nodes },
  } as unknown as ChatSnapshot
  const useChat = ((selector: (value: ChatSnapshot) => unknown) => selector(snapshot)) as UseChat
  return { callId, useChat } as PropsRuntime<'conversation.approval.detail'>
}

function detailOf(argsRaw: string): string | undefined {
  return approvalDetail({ callId: 'c1', argsRaw })
}

describe('approvalDetail', () => {
  it('returns nothing for absent, malformed, non-object, or empty arguments', () => {
    expect(approvalDetail(undefined)).toBeUndefined()
    expect(detailOf('{')).toBeUndefined()
    expect(detailOf('[]')).toBeUndefined()
    expect(detailOf('{}')).toBeUndefined()
  })

  it('shows a string command as-is', () => {
    expect(detailOf('{"command":"pnpm test"}')).toBe('pnpm test')
  })

  it('shows a write path with its leading content lines and a clip marker', () => {
    const content = Array.from({ length: 45 }, (_, index) => `line ${index + 1}`).join('\n')
    const lines = (detailOf(JSON.stringify({ file_path: '/etc/hosts', content })) ?? '').split('\n')
    expect(lines[0]).toBe('/etc/hosts')
    expect(lines.slice(1, 41)).toEqual(Array.from({ length: 40 }, (_, index) => `line ${index + 1}`))
    expect(lines.slice(41)).toEqual(['…'])
  })

  it('shows an edit path with removed and added lines', () => {
    expect(detailOf('{"file_path":"a.ts","old_string":"x","new_string":"y"}')).toBe('a.ts\n- x\n+ y')
  })

  it('shows run_code source', () => {
    expect(detailOf('{"code":"print(1)"}')).toBe('print(1)')
  })

  it('pretty-prints other arguments', () => {
    expect(detailOf('{"command":42}')).toBe('{\n  "command": 42\n}')
    expect(detailOf('{"query":"select 1","limit":5}')).toBe('{\n  "query": "select 1",\n  "limit": 5\n}')
  })

  it('clips pretty-printed arguments at 4096 characters', () => {
    const json = JSON.stringify({ query: 'x'.repeat(5000) }, null, 2)
    expect(detailOf(JSON.stringify({ query: 'x'.repeat(5000) }))).toBe(`${json.slice(0, 4096)}…`)
  })
})

describe('ApprovalCommand', () => {
  it('renders the running correlated Tool command', () => {
    render(<ApprovalCommand {...props([
      { kind: 'assistant-step', data: {} },
      { kind: 'tool-call', data: { root: { phase: 'start', args: PartialArguments.fromText('{"command":"wrong"}'), callId: 'other', argsRaw: '{"command":"wrong"}' } } },
      { kind: 'tool-call', data: { root: { phase: 'start', args: PartialArguments.fromText('{"command":"pnpm test"}'), callId: 'call-1', argsRaw: '{"command":"pnpm test"}' } } },
    ] as never)} />)

    expect(screen.getByText('pnpm test')).toBeTruthy()
  })

  it('renders a multi-line write detail with its path', () => {
    const argsRaw = JSON.stringify({ file_path: '/etc/hosts', content: 'first\nsecond' })
    const { container } = render(<ApprovalCommand {...props([
      { kind: 'tool-call', data: { root: { phase: 'start', callId: 'call-1', argsRaw } } },
    ] as never)} />)

    expect(container.querySelector('pre')?.textContent).toBe('/etc/hosts\nfirst\nsecond')
  })

  it('omits absent, uncorrelated, preparing, and settled Tool calls', () => {
    const { container, rerender } = render(<ApprovalCommand {...props([
      { kind: 'assistant-step', data: {} },
      { kind: 'tool-call', data: { root: undefined } },
      { kind: 'tool-call', data: { root: { phase: 'start', args: PartialArguments.fromText('{}'), callId: 'other', argsRaw: '{}' } } },
      { kind: 'tool-call', data: { root: { phase: 'preparing', args: PartialArguments.EMPTY, callId: 'call-1', name: 'bash' } } },
      {
        kind: 'tool-call',
        data: { root: { kind: 'tool-result', callId: 'call-1', argsRaw: '{"command":"ignored"}' } },
      },
    ] as never)} />)
    expect(container.textContent).toBe('')

    rerender(<ApprovalCommand {...props([
      { kind: 'tool-call', data: { root: { phase: 'start', args: PartialArguments.fromText('{}'), callId: 'call-1', argsRaw: '{}' } } },
    ] as never)} />)
    expect(container.textContent).toBe('')
  })
})

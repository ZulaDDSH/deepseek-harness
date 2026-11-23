// @vitest-environment jsdom
import type { ChatSnapshot, UseChat } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { PartialArguments } from '@deepseek-ai/dsh-util-values'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ApprovalCommand, commandOf, describeApproval } from '../src/client/chat/ApprovalCommand.tsx'

function props(
  nodes: readonly unknown[],
  callId = 'call-1',
  onAvailability?: (available: boolean) => void,
): PropsRuntime<'conversation.approval.detail'> & PropsLocale<'chat'> {
  const snapshot = {
    nodes: { values: () => nodes },
  } as unknown as ChatSnapshot
  const useChat = ((selector: (value: ChatSnapshot) => unknown) => selector(snapshot)) as UseChat
  return { callId, useChat, onAvailability, t: (key: string) => key } as unknown as PropsRuntime<'conversation.approval.detail'> & PropsLocale<'chat'>
}

function startNode(callId: string, argsRaw: string, name?: string): unknown {
  return { kind: 'tool-call', data: { root: { phase: 'start', callId, argsRaw, ...(name === undefined ? {} : { name }) } } }
}

describe('commandOf', () => {
  it('accepts only a non-empty string command from valid JSON arguments', () => {
    expect(commandOf(undefined)).toBeUndefined()
    expect(commandOf({ callId: 'c1', name: 'bash', argsRaw: '{' })).toBeUndefined()
    expect(commandOf({ callId: 'c1', name: 'bash', argsRaw: '{}' })).toBeUndefined()
    expect(commandOf({ callId: 'c1', name: 'bash', argsRaw: '{"command":42}' })).toBeUndefined()
    expect(commandOf({ callId: 'c1', name: 'bash', argsRaw: '{"command":""}' })).toBeUndefined()
    expect(commandOf({ callId: 'c1', name: 'bash', argsRaw: '{"command":"pnpm test"}' })).toBe('pnpm test')
  })

  it('reads the text typed into a terminal as its command', () => {
    expect(commandOf({ callId: 'c1', name: 'terminal_send', argsRaw: '{"sessionId":"pty-1","text":"pnpm run dev"}' })).toBe('pnpm run dev')
    expect(commandOf({ callId: 'c1', name: 'terminal_send', argsRaw: '{"sessionId":"pty-1","text":"","submit":true}' })).toBeUndefined()
    expect(commandOf({ callId: 'c1', name: 'write', argsRaw: '{"path":"notes.md","text":"draft"}' })).toBeUndefined()
  })
})

function detailOf(argsRaw: string): string | undefined {
  return describeApproval({ callId: 'c1', argsRaw })?.preview
}

describe('describeApproval preview', () => {
  it('returns nothing for absent, malformed, non-object, or empty arguments', () => {
    expect(describeApproval(undefined)).toBeUndefined()
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

  it('shows terminal input as the approval detail', () => {
    expect(describeApproval({ callId: 'c1', name: 'terminal_send', argsRaw: '{"text":"pnpm run dev"}' })?.preview).toBe('pnpm run dev')
  })
})

describe('describeApproval', () => {
  const view = (argsRaw: string, name?: string) => describeApproval({ callId: 'c1', ...(name === undefined ? {} : { name }), argsRaw })

  it('lists the working directory and timeout next to a command', () => {
    expect(view('{"command":"rm -rf build","workdir":"C:\\\\work\\\\other","timeout":5}')).toEqual({
      preview: 'rm -rf build',
      rest: [['workdir', '"C:\\\\work\\\\other"'], ['timeout', '5']],
      full: undefined,
    })
  })

  it('lists the replacement mode next to an edit', () => {
    expect(view('{"file_path":"a.ts","old_string":"x","new_string":"y","replace_all":true}')).toEqual({
      preview: 'a.ts\n- x\n+ y',
      rest: [['replace_all', 'true']],
      full: undefined,
    })
  })

  it('lists the terminal target and submit flag next to typed text', () => {
    expect(view('{"sessionId":"pty-2","text":"ls","submit":true}', 'terminal_send')).toEqual({
      preview: 'ls',
      rest: [['sessionId', '"pty-2"'], ['submit', 'true']],
      full: undefined,
    })
  })

  it('shows terminal input without text through the generic arguments', () => {
    expect(view('{"sessionId":"pty-2","text":"","submit":true}', 'terminal_send')?.preview)
      .toBe('{\n  "sessionId": "pty-2",\n  "text": "",\n  "submit": true\n}')
  })

  it('offers the complete arguments when write content, a row value, or generic JSON is clipped', () => {
    const content = Array.from({ length: 45 }, (_, index) => `line ${index + 1}`).join('\n')
    const write = { file_path: 'a.txt', content }
    expect(view(JSON.stringify(write))?.full).toBe(JSON.stringify(write, null, 2))
    const longRow = { command: 'run', env: 'v'.repeat(300) }
    const rowView = view(JSON.stringify(longRow))
    expect(rowView?.rest[0]?.[1].endsWith('…')).toBe(true)
    expect(rowView?.full).toBe(JSON.stringify(longRow, null, 2))
    const generic = { query: 'x'.repeat(5000) }
    expect(view(JSON.stringify(generic))?.full).toBe(JSON.stringify(generic, null, 2))
  })

  it('offers no full view when nothing was clipped, and reports an argument-free call as available', () => {
    expect(view('{"command":"ls"}')?.full).toBeUndefined()
    expect(view('{}')).toEqual({ preview: undefined, rest: [], full: undefined })
  })
})

describe('ApprovalCommand arguments', () => {
  it('renders every remaining argument as text beside the command', () => {
    const { container } = render(<ApprovalCommand {...props([
      startNode('call-1', '{"command":"ls","workdir":"<b>elsewhere</b>"}', 'bash'),
    ])} />)

    expect(container.querySelector('pre')?.textContent).toBe('ls')
    expect(container.querySelector('dt')?.textContent).toBe('workdir')
    expect(container.querySelector('dd')?.textContent).toBe('"<b>elsewhere</b>"')
    expect(container.querySelector('b')).toBeNull()
  })

  it('expands to the complete arguments when the preview is clipped', () => {
    const content = Array.from({ length: 45 }, (_, index) => `line ${index + 1}`).join('\n')
    const { container } = render(<ApprovalCommand {...props([
      startNode('call-1', JSON.stringify({ file_path: 'a.txt', content })),
    ])} />)

    const details = container.querySelector('details')
    expect(details?.querySelector('summary')?.textContent).toBe('approval.fullArguments')
    expect(details?.querySelector('pre')?.textContent).toContain('line 45')
    expect(container.querySelector('pre')?.textContent).not.toContain('line 45')
  })

  it('reports whether a usable correlated call exists, including an argument-free one', () => {
    const reports: boolean[] = []
    const onAvailability = (available: boolean): void => { reports.push(available) }
    const { rerender } = render(<ApprovalCommand {...props([], 'call-1', onAvailability)} />)
    rerender(<ApprovalCommand {...props([startNode('call-1', '{}')], 'call-1', onAvailability)} />)
    rerender(<ApprovalCommand {...props([startNode('call-1', '{')], 'call-1', onAvailability)} />)
    expect(reports).toEqual([false, true, false])
  })
})

describe('ApprovalCommand', () => {
  it('renders the running correlated Tool command', () => {
    render(<ApprovalCommand {...props([
      { kind: 'assistant-step', data: {} },
      { kind: 'tool-call', data: { root: { phase: 'start', args: PartialArguments.fromText('{"command":"wrong"}'), callId: 'other', name: 'bash', argsRaw: '{"command":"wrong"}' } } },
      { kind: 'tool-call', data: { root: { phase: 'start', args: PartialArguments.fromText('{"command":"pnpm test"}'), callId: 'call-1', name: 'bash', argsRaw: '{"command":"pnpm test"}' } } },
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

// @vitest-environment jsdom

import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { StartedToolCall } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ChatViewSlotProps } from '../src/client/contract/slots.ts'
import type { PartialAssistant } from '../src/client/contract/snapshot.ts'
import { RunningStatus } from '../src/client/chat/RunningStatus.tsx'
import { en, zh } from '../src/client/locale.ts'
import { chatSnapshotFixture } from './chat-snapshot-fixture.client.ts'

const t = makeTranslate(zh, commonZh)
const tEn = makeTranslate(en, commonEn)

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(5_000) })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

function chatHook(input: Parameters<typeof chatSnapshotFixture>[0] = {}): ChatViewSlotProps['useChat'] {
  const snapshot = chatSnapshotFixture(input)
  return ((select: (value: typeof snapshot) => unknown) => select(snapshot)) as ChatViewSlotProps['useChat']
}

function startedCall(name: string, argsRaw: string, time: number): StartedToolCall {
  return { phase: 'start', callId: `${name}-${time}`, name, argsRaw, turn: 1, step: 1, time, subCalls: [] }
}

function statusHarness(startTime?: number, useChat = chatHook(), onStop = vi.fn(), awaitingUser = false) {
  const view = render(<RunningStatus startTime={startTime} useChat={useChat} awaitingUser={awaitingUser} onStop={onStop} t={t} />)
  return {
    ...view,
    content: () => view.container.querySelector('[data-chat-running-label]'),
    hint: () => view.container.querySelector('[data-chat-running-stuck]'),
    set: (nextStartTime?: number, nextChat = useChat, nextAwaitingUser = awaitingUser) => {
      view.rerender(
        <RunningStatus startTime={nextStartTime} useChat={nextChat} awaitingUser={nextAwaitingUser} onStop={onStop} t={t} />,
      )
    },
  }
}

describe('RunningStatus', () => {
  it('keeps deep-diving time visible beside the actual operation and active task', () => {
    const view = render(<RunningStatus startTime={1_000} step={4} task="Fix the importer" useChat={chatHook({ runningCalls: [startedCall('edit', '{"file_path":"src/import.ts"}', 4_000)] })} onStop={vi.fn()} t={tEn} />)
    expect(view.container.querySelector('[data-chat-running-label]')?.textContent).toContain('Deep diving for 4s, step 4')
    expect(view.container.querySelector('[data-chat-running-operation]')?.textContent).toContain('import.ts')
    expect(view.container.querySelector('[data-chat-running-task]')?.textContent).toBe('Current task: Fix the importer')
  })
  it('waits for an open Turn start before allocating its clock', () => {
    const view = statusHarness()
    expect(view.content()?.textContent).toBe('深度求索中...')
    expect(vi.getTimerCount()).toBe(0)
    view.set(1_000)
    expect(view.content()?.textContent).toMatch(/^深度求索中，用时 \d+秒\.\.\.$/)
    expect(view.content()?.querySelectorAll('[data-shimmer="true"]')).toHaveLength(1)
    expect(vi.getTimerCount()).toBe(1)
    view.set()
    expect(view.content()?.textContent).toBe('深度求索中...')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps the indicator mounted while a continuous run moves to the next Turn', () => {
    const view = statusHarness(1_000)
    const content = view.content()
    const status = view.getByRole('status')
    const initialText = content?.textContent
    act(() => { vi.advanceTimersByTime(2_000) })
    expect(content?.textContent).toMatch(/^深度求索中，用时 \d+秒\.\.\.$/)
    expect(content?.textContent).not.toBe(initialText)
    view.set(7_000)
    expect(view.content()).toBe(content)
    expect(content?.textContent).toMatch(/^深度求索中，用时 \d+秒\.\.\.$/)
    expect(vi.getTimerCount()).toBe(1)
    const nextTurnText = content?.textContent
    act(() => { vi.advanceTimersByTime(2_000) })
    expect(content?.textContent).toMatch(/^深度求索中，用时 \d+秒\.\.\.$/)
    expect(content?.textContent).not.toBe(nextTurnText)
    expect(view.getByRole('status')).toBe(status)
    expect(status.textContent).toBe('深度求索中...')
    view.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps the duration nonnegative when the start is ahead of the local clock', () => {
    const view = statusHarness(6_000)
    expect(view.content()?.textContent).toMatch(/^深度求索中，用时 \d+秒\.\.\.$/)
    expect(view.content()?.textContent).not.toContain('-')
    act(() => { vi.advanceTimersByTime(3_000) })
    expect(view.content()?.textContent).toMatch(/^深度求索中，用时 \d+秒\.\.\.$/)
    expect(view.content()?.textContent).not.toContain('-')
  })

  it('names the open step beside the elapsed time and keeps it while the clock runs', () => {
    const view = render(<RunningStatus startTime={1_000} step={67} useChat={chatHook()} onStop={vi.fn()} t={t} />)
    const content = view.container.querySelector('[data-chat-running-label]')
    expect(content?.textContent).toMatch(/^深度求索中，用时 \d+秒，第 67 步\.\.\.$/)
    act(() => { vi.advanceTimersByTime(2_000) })
    expect(content?.textContent).toMatch(/^深度求索中，用时 \d+秒，第 67 步\.\.\.$/)
    view.unmount()
  })

  it('names a background job read with its elapsed time and the wait variant', () => {
    const view = statusHarness(1_000, chatHook({
      runningCalls: [startedCall('job_output', '{"job_id":"job_9","wait":true}', 4_000)],
    }))
    expect(view.content()?.textContent).toContain('正在等待后台任务 job_9 · 1秒')
    act(() => { vi.advanceTimersByTime(3_000) })
    expect(view.content()?.textContent).toContain('正在等待后台任务 job_9 · 4秒')
  })

  it('labels a job read without a wait as reading its output', () => {
    const view = statusHarness(1_000, chatHook({
      runningCalls: [startedCall('job_output', '{"job_id":"job_9"}', 4_000)],
    }))
    expect(view.content()?.textContent).toContain('正在读取后台任务 job_9 的输出 · 1秒')
  })

  it('counts streamed text as an approximate token figure while it grows', () => {
    const partial: PartialAssistant = { turn: 1, step: 1, blocks: [{ kind: 'text', text: 'a'.repeat(2_400) }] }
    const view = statusHarness(1_000, chatHook({ partial }))
    expect(view.content()?.textContent).toContain('正在撰写回复 · 0秒 · 已生成约 600 词元')
    act(() => { vi.advanceTimersByTime(2_000) })
    expect(view.content()?.textContent).toContain('正在撰写回复 · 2秒 · 已生成约 600 词元')
  })

  it('counts reasoning as thinking with its token figure', () => {
    const partial: PartialAssistant = { turn: 1, step: 1, blocks: [{ kind: 'reasoning', text: 'b'.repeat(400) }] }
    const view = statusHarness(1_000, chatHook({ partial }))
    expect(view.content()?.textContent).toContain('正在思考 · 0秒 · 已生成约 100 词元')
  })

  it('shows thinking without a token figure before any output arrives', () => {
    const partial: PartialAssistant = { turn: 1, step: 1, blocks: [] }
    const view = statusHarness(1_000, chatHook({ partial }))
    expect(view.content()?.textContent).toContain('正在思考 · 0秒')
  })

  it('offers Stop after two silent minutes without stopping the Turn itself', () => {
    const onStop = vi.fn()
    const view = statusHarness(1_000, chatHook(), onStop)
    act(() => { vi.advanceTimersByTime(119_000) })
    expect(view.hint()).toBeNull()
    act(() => { vi.advanceTimersByTime(1_000) })
    expect(view.hint()?.textContent).toContain('已经 2分0秒 没有新动静')
    expect(onStop).not.toHaveBeenCalled()
    fireEvent.click(view.getByRole('button', { name: '停止' }))
    expect(onStop).toHaveBeenCalledTimes(1)
  })

  it('keeps the hint hidden while an approval or question is pending', () => {
    const chat = chatHook({ runningCalls: [startedCall('ask_user_question', '{}', 4_000)] })
    const view = statusHarness(1_000, chat, vi.fn(), true)
    act(() => { vi.advanceTimersByTime(130_000) })
    expect(view.content()?.textContent).toContain('等待你的操作')
    expect(view.hint()).toBeNull()
  })

  it('counts silence from the answer, not from the wait the user caused', () => {
    const chat = chatHook({ runningCalls: [startedCall('bash', '{"command":"ls"}', 4_000)] })
    const view = statusHarness(1_000, chat, vi.fn(), true)
    act(() => { vi.advanceTimersByTime(300_000) })
    expect(view.hint()).toBeNull()
    view.set(1_000, chat, false)
    act(() => { vi.advanceTimersByTime(119_000) })
    expect(view.hint()).toBeNull()
    act(() => { vi.advanceTimersByTime(1_000) })
    expect(view.hint()).not.toBeNull()
  })

  it('times the hint identically under StrictMode double effects and renders', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const partial: PartialAssistant = { turn: 1, step: 1, blocks: [{ kind: 'text', text: 'a'.repeat(40) }] }
    const view = render(
      <StrictMode>
        <RunningStatus startTime={1_000} useChat={chatHook({ partial })} onStop={vi.fn()} t={t} />
      </StrictMode>,
    )
    const line = () => view.container.querySelector('[data-chat-running-label]')
    const hint = () => view.container.querySelector('[data-chat-running-stuck]')
    expect(line()?.textContent).toContain('正在撰写回复 · 0秒 · 已生成约 10 词元')
    act(() => { vi.advanceTimersByTime(3_000) })
    expect(line()?.textContent).toContain('正在撰写回复 · 3秒 · 已生成约 10 词元')
    act(() => { vi.advanceTimersByTime(116_000) })
    expect(hint()).toBeNull()
    act(() => { vi.advanceTimersByTime(1_000) })
    expect(hint()).not.toBeNull()
    expect(vi.getTimerCount()).toBe(1)
    view.unmount()
    expect(vi.getTimerCount()).toBe(0)
    expect(error).not.toHaveBeenCalled()
  })

  it('reads in English with the quiet-Turn hint and a Stop action', () => {
    const chat = chatHook({ runningCalls: [startedCall('bash', '{"command":"pnpm test"}', 4_000)] })
    const view = render(<RunningStatus startTime={1_000} step={3} useChat={chat} onStop={vi.fn()} t={tEn} />)
    expect(view.container.querySelector('[data-chat-running-label]')?.textContent)
      .toMatch(/^Deep diving for \d+s, step 3\.\.\.Running commands: pnpm test · 1s$/)
    act(() => { vi.advanceTimersByTime(120_000) })
    expect(view.container.querySelector('[data-chat-running-stuck]')?.textContent)
      .toBe('No activity for 2m 0s. The model or a tool may be stuck; you can stop this turn.Stop')
    expect(view.getByRole('button', { name: 'Stop' })).toBeTruthy()
  })

  it('words English job, retry, and generation lines plainly', () => {
    const job = render(<RunningStatus startTime={1_000} useChat={chatHook({
      runningCalls: [startedCall('job_output', '{"job_id":"job_9","wait":true}', 4_000)],
    })} onStop={vi.fn()} t={tEn} />)
    expect(job.container.querySelector('[data-chat-running-label]')?.textContent).toContain('Waiting on background job job_9 · 1s')
    job.unmount()
    const thinking = render(<RunningStatus startTime={1_000} useChat={chatHook({
      partial: { turn: 1, step: 1, blocks: [{ kind: 'reasoning', text: 'b'.repeat(400) }] },
    })} onStop={vi.fn()} t={tEn} />)
    expect(thinking.container.querySelector('[data-chat-running-label]')?.textContent).toContain('Thinking · 0s · about 100 tokens so far')
  })

  it('restarts the silence clock when the Chat snapshot changes', () => {
    const view = statusHarness(1_000)
    act(() => { vi.advanceTimersByTime(100_000) })
    view.set(1_000, chatHook())
    act(() => { vi.advanceTimersByTime(119_000) })
    expect(view.hint()).toBeNull()
    act(() => { vi.advanceTimersByTime(1_000) })
    expect(view.hint()).not.toBeNull()
  })

  it('replaces the concrete activity with the plain clock when the Turn ends', () => {
    const view = statusHarness(1_000, chatHook({
      runningCalls: [startedCall('bash', '{"command":"ls"}', 4_000)],
    }))
    expect(view.content()?.textContent).toContain('命令')
    expect(vi.getTimerCount()).toBe(1)
    view.set()
    expect(view.content()?.textContent).toBe('深度求索中...')
    expect(vi.getTimerCount()).toBe(0)
  })
})

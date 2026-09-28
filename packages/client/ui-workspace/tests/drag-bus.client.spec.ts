/**
 * Cross-pane drag bus: the in-flight gesture that one pane publishes and
 * another observes.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  beginChatDrag, chatDragSessionId, endChatDrag, subscribeChatDrag,
} from '../src/client/rows/drag-bus.ts'

describe('cross-pane drag bus', () => {
  it('starts empty', () => {
    expect(chatDragSessionId()).toBeNull()
  })

  it('publishes the dragged session and notifies subscribers', () => {
    const listener = vi.fn()
    const off = subscribeChatDrag(listener)
    beginChatDrag('session-a')
    expect(chatDragSessionId()).toBe('session-a')
    expect(listener).toHaveBeenCalledTimes(1)
    off()
  })

  it('clears the gesture and notifies on end', () => {
    const listener = vi.fn()
    const off = subscribeChatDrag(listener)
    beginChatDrag('session-a')
    endChatDrag()
    expect(chatDragSessionId()).toBeNull()
    expect(listener).toHaveBeenCalledTimes(2)
    off()
  })

  it('does not notify for an end with nothing in flight', () => {
    const listener = vi.fn()
    const off = subscribeChatDrag(listener)
    endChatDrag()
    expect(listener).not.toHaveBeenCalled()
    off()
  })

  it('stops notifying after unsubscribe', () => {
    const listener = vi.fn()
    subscribeChatDrag(listener)()
    beginChatDrag('session-a')
    expect(listener).not.toHaveBeenCalled()
    endChatDrag()
  })
})

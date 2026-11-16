// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionNode } from '../src/client/tree.ts'
import { sessionDragOrder, useNativeDragAcceptance } from '../src/client/rows/drag.ts'

describe('Workspace native drag acceptance', () => {
  it('accepts a drag without transfer data and removes listeners on unmount', () => {
    const { unmount } = renderHook(() => { useNativeDragAcceptance(true) })
    const event = new Event('dragover', { cancelable: true })
    Object.defineProperty(event, 'dataTransfer', { value: null })
    document.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    unmount()
    const next = new Event('dragover', { cancelable: true })
    document.dispatchEvent(next)
    expect(next.defaultPrevented).toBe(false)
  })

  it('rejects a visible target absent from the persisted account', () => {
    const row = (id: string): SessionNode => ({
      id: id as SessionId, title: id, blank: false, running: false, runningSubagentCount: 0,
      completed: false, pinned: false, archived: false, updatedAt: 1,
    })
    const first = row('first')
    const last = row('last')
    expect(sessionDragOrder([first.id], [first, last], {
      sessionId: first.id, accountKey: 'fixture', pinned: false, over: null,
    }, { id: last.id, half: 'after' })).toBeUndefined()
  })
})

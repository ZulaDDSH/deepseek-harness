// @vitest-environment jsdom
/** Hover dwell, lazy comparison reads, and Sidebar navigation from turn-tail rows. */
import { useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { ChangedFiles } from '../src/client/ChangedFiles.tsx'
import { ChangesDiffStore } from '../src/client/changes-diff.ts'
import { changesDiffUrl } from '../src/changes.ts'
import { en } from '../src/client/locales.ts'

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { cleanup(); vi.useRealTimers() })

const sessionId = SessionId('hover-session')
const files = ['main.ts', 'second.ts'].map(path => ({ path, display: path, added: 1, deleted: 1 }))

function mount(fileCount = 2) {
  const diffs = new ChangesDiffStore()
  const loadChangesDiff = vi.fn<ChangesDiffStore['load']>().mockResolvedValue(undefined)
  const openReview = vi.fn()
  const subscribe = diffs.state.subscribe.bind(diffs.state)
  const getSnapshot = diffs.state.getSnapshot.bind(diffs.state)
  const changes = { seq: 5, files: files.slice(0, fileCount), total: fileCount, added: fileCount, deleted: fileCount }
  const view = render(<ChangedFiles changes={changes}
    cwd="/workspace" sessionId={sessionId} t={makeTranslate(en)} openReview={openReview}
    loadChangesDiff={loadChangesDiff}
    useChangesDiff={select => select(useSyncExternalStore(subscribe, getSnapshot))} />)
  if (fileCount > 1) fireEvent.click(screen.getByRole('button', { name: 'Edited 2 files' }))
  const row = fileCount === 1
    ? screen.getByRole('button', { name: 'View changes to main.ts' })
    : screen.getByRole('menuitem', { name: /main\.ts/ })
  const hover = fileCount === 1 ? row : row.querySelector<HTMLElement>('[class*="menuRow"]')!
  return { view, diffs, loadChangesDiff, openReview, row, hover }
}

it.each([1, 2])('reads only after 500ms and renders the selected comparison with %i files', (fileCount) => {
  const { row, hover, diffs, loadChangesDiff, openReview } = mount(fileCount)
  fireEvent.pointerEnter(hover)
  act(() => { vi.advanceTimersByTime(499) })
  expect(loadChangesDiff).not.toHaveBeenCalled()
  expect(document.querySelector('[data-changes-hover-preview]')).toBeNull()
  act(() => { vi.advanceTimersByTime(1) })
  expect(loadChangesDiff).toHaveBeenCalledExactlyOnceWith(sessionId, 5, 0)
  expect(screen.getByText('Reading changes…')).toBeTruthy()
  act(() => { diffs.state.set({ [changesDiffUrl(sessionId, 5, 0)]: {
    kind: 'text', path: 'main.ts', display: 'main.ts', before: true, after: true, coarse: false,
    hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-const value = 1', '+const value = 2'] }],
  } }) })
  const preview = document.querySelector('[data-changes-hover-preview]')!
  expect(preview.querySelector('[data-review-view="unified"]')).not.toBeNull()
  expect(preview.querySelector('[data-diff-side]')).toBeNull()
  expect(preview.querySelector('[data-diff-line="del"]')?.textContent).toContain('const value = 1')
  expect(preview.querySelector('[data-diff-line="add"]')?.textContent).toContain('const value = 2')
  expect(preview.textContent).toContain('/workspace/main.ts')
  if (fileCount === 1) expect(screen.getByRole('button', { name: 'View changes to main.ts', description: '/workspace/main.ts' })).toBe(row)
  expect(preview.querySelector('[data-changes-preview-path]')?.getAttribute('tabindex')).toBeNull()
  fireEvent.pointerLeave(hover)
  fireEvent.pointerEnter(preview)
  act(() => { vi.advanceTimersByTime(500) })
  expect(document.querySelector('[data-changes-hover-preview]')).toBe(preview)
  fireEvent.pointerDown(row)
  fireEvent.click(row)
  act(() => { vi.advanceTimersByTime(100) })
  expect(document.querySelector('[data-changes-hover-preview]')).toBeNull()
  expect(openReview).toHaveBeenCalledExactlyOnceWith(0)
})

it('keeps a status note for a comparison with no hunks', () => {
  const { hover, diffs } = mount()
  diffs.state.set({ [changesDiffUrl(sessionId, 5, 0)]: {
    kind: 'text', path: 'main.ts', display: 'main.ts', before: true, after: true, coarse: false, hunks: [],
  } })
  fireEvent.pointerEnter(hover)
  act(() => { vi.advanceTimersByTime(500) })
  expect(document.querySelector('[data-changes-hover-preview] [data-diff-note="empty"]')?.textContent).toBe('Both sides hold the same lines')
})

it('cancels a short hover and the pending dwell when unmounted', () => {
  const { hover, view, loadChangesDiff } = mount()
  fireEvent.pointerEnter(hover)
  act(() => { vi.advanceTimersByTime(499) })
  fireEvent.pointerLeave(hover)
  act(() => { vi.advanceTimersByTime(500) })
  expect(loadChangesDiff).not.toHaveBeenCalled()
  fireEvent.pointerEnter(hover)
  view.unmount()
  act(() => { vi.advanceTimersByTime(500) })
  expect(loadChangesDiff).not.toHaveBeenCalled()
})

it('previews each row independently, retries failed reads, and closes on Escape', () => {
  const { hover, diffs, loadChangesDiff } = mount()
  diffs.state.set({ [changesDiffUrl(sessionId, 5, 0)]: 'error', [changesDiffUrl(sessionId, 5, 1)]: 'missing' })
  fireEvent.pointerEnter(hover)
  act(() => { vi.advanceTimersByTime(500) })
  const retry = screen.getByRole('button', { name: 'Retry' })
  fireEvent.pointerDown(retry)
  fireEvent.click(retry)
  expect(loadChangesDiff).toHaveBeenCalledExactlyOnceWith(sessionId, 5, 0)
  expect(screen.getByRole('menu')).toBeTruthy()
  fireEvent.pointerLeave(hover)
  const second = screen.getByRole('menuitem', { name: /second\.ts/ })
  fireEvent.pointerEnter(second.querySelector<HTMLElement>('[class*="menuRow"]')!)
  act(() => { vi.advanceTimersByTime(200) })
  act(() => { vi.advanceTimersByTime(300) })
  expect(document.querySelectorAll('[data-changes-hover-preview]')).toHaveLength(1)
  expect(document.querySelector('[data-changes-preview-path]')?.textContent).toBe('/workspace/second.ts')
  fireEvent.keyDown(second, { key: 'Escape' })
  act(() => { vi.advanceTimersByTime(100) })
  expect(document.querySelector('[data-changes-hover-preview]')).toBeNull()
})

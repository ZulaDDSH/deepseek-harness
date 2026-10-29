// @vitest-environment jsdom
/** FontFamilyRow behavior: one button per preset, clicks drive setFontFamily, selection follows the store mirror. */
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { FontFamilyRow } from '../src/client/FontFamilyRow.tsx'
import type { FontFamilyRowComponentProps } from '../src/client/FontFamilyRow.tsx'
import type { FontFamily } from '../src/theme-settings.ts'
import { createFontFamilyRowStore } from '../src/client/settings-store.ts'

// Every fixture carries the resource hook the resources plugin merges into GlobalStandardProps.
const useResource = (() => ({ status: 'none' as const, value: undefined, failure: undefined, reload: () => {} })) as GlobalStandardProps['useResource']
const usePanelInfo: GlobalStandardProps['usePanelInfo'] = selector => selector({ activePanelId: null })

afterEach(cleanup)

const COPY: Record<string, string> = {
  'fontFamily.title': 'Font',
  'fontFamily.description': 'Typeface for the interface and conversation',
  'fontFamily.default': 'Default',
  'fontFamily.readable': 'Easy to read',
  'fontFamily.serif': 'Serif',
  'fontFamily.dyslexia': 'Dyslexia-friendly',
  'fontFamily.mono': 'Monospace',
}

/** Empty global standard-kit hooks (the row reads neither). */
function emptySessions() {
  const store = createSnapshotStore<SessionListState>(
    { ids: [], byId: {}, phase: 'ready', projectionsBySession: {} })
  return bindSnapshotSelector(store)
}
function emptyWorkspaces() {
  const store = createSnapshotStore<WorkspaceSnapshot>({
    items: [], archivedSessionIds: [], pinnedSessionIds: [], state: 'idle', phase: 'ready', error: null,
  })
  return bindSnapshotSelector(store)
}

type AttentionSnapshot = Parameters<Parameters<FontFamilyRowComponentProps['useSessionStatus']>[0]>[0]
const noAttention: AttentionSnapshot = new Map()
const useSessionStatus: FontFamilyRowComponentProps['useSessionStatus'] = selector => selector(noAttention)

function mount(fontFamily: FontFamily = 'default') {
  const store = createFontFamilyRowStore().create()
  store.actions.sync(fontFamily, 0)
  const setFontFamily = vi.fn()
  const props: FontFamilyRowComponentProps = {
    useSessions: emptySessions(),
    useSessionStatus,
    usePanelInfo, useSessionRetainInfo: () => undefined, useResource,
    useWorkspaces: emptyWorkspaces(),
    useStore: bindSnapshotSelector(store),
    actions: store.actions,
    t: (key: string) => COPY[key] ?? key,
    setFontFamily,
  }
  render(<FontFamilyRow {...props} />)
  return { store, setFontFamily }
}

const option = (name: string): HTMLButtonElement => screen.getByRole('button', { name }) as HTMLButtonElement

describe('FontFamilyRow', () => {
  it('renders every preset and marks the stored one pressed', () => {
    mount('serif')
    expect(screen.getByText('Font')).toBeDefined()
    expect(screen.getAllByRole('button')).toHaveLength(5)
    expect(option('Serif').getAttribute('aria-pressed')).toBe('true')
    expect(option('Default').getAttribute('aria-pressed')).toBe('false')
    expect(option('Serif').style.fontFamily).toContain('Georgia')
  })

  it('clicking a preset calls setFontFamily; selection follows the store, not the click', () => {
    const b = mount()
    fireEvent.click(option('Dyslexia-friendly'))
    expect(b.setFontFamily).toHaveBeenCalledWith('dyslexia')
    expect(option('Dyslexia-friendly').getAttribute('aria-pressed')).toBe('false')
    act(() => { b.store.actions.sync('dyslexia', 1) })
    expect(option('Dyslexia-friendly').getAttribute('aria-pressed')).toBe('true')
  })
})

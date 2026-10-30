// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { sessionSnapshot as sessionFixture } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { EMPTY_CONVERSATION_SNAPSHOT } from '../src/client/contract/snapshot.ts'
import type { ConversationSessionSlotProps } from '../src/client/contract/slots.ts'
import type { ViewTab } from '../src/client/contract/views.ts'
import { DefaultConversationViews } from '../src/client/skeleton/DefaultConversationViews.tsx'

afterEach(cleanup)

const tabs: ViewTab[] = [
  { id: 'chat', label: 'Chat' },
  { id: 'subagent-setup', label: 'Orchestrator & Subagent Setup' },
]

function renderViews(options: { blank: boolean; selected: string }) {
  const renderSlot = vi.fn((_key: string, _owner: object, slotOptions?: { only?: string }) =>
    <div data-testid={`view-${slotOptions?.only ?? ''}`} />)
  const session = { ...sessionFixture('s1' as SessionId), blank: options.blank }
  const props: ConversationSessionSlotProps = {
    useSession: (select: (value: typeof session) => unknown) => select(session),
    useConversation: (select: (value: typeof EMPTY_CONVERSATION_SNAPSHOT) => unknown) => select(EMPTY_CONVERSATION_SNAPSHOT),
    useConversationViews: (select: (value: ViewTab[]) => unknown) => select(tabs),
    useInput: (select: (value: { draft: string }) => unknown) => select({ draft: '' }),
    useInspectCall: (select: (value: undefined) => unknown) => select(undefined),
    useStore: (select: (value: { view: string; draft: string }) => unknown) => select({ view: options.selected, draft: '' }),
    inputActions: {},
    actions: { setDraft: vi.fn(), completeViewRequest: vi.fn() },
    bindDraftMirror: () => () => {},
    openView: vi.fn(),
    renderSlot,
  } as never
  const view = render(<DefaultConversationViews {...props} />)
  return { view, renderSlot }
}

describe('DefaultConversationViews on a blank Session', () => {
  it('renders the Subagent Setup view before the first message', () => {
    const { view } = renderViews({ blank: true, selected: 'subagent-setup' })
    expect(view.getByTestId('view-subagent-setup')).toBeTruthy()
  })

  it('still renders nothing for the Chat view, so the hero stays alone', () => {
    const { view, renderSlot } = renderViews({ blank: true, selected: 'chat' })
    expect(view.container.firstChild).toBeNull()
    expect(renderSlot).not.toHaveBeenCalled()
  })

  it('renders the selected view on a started Session', () => {
    const { view } = renderViews({ blank: false, selected: 'chat' })
    expect(view.getByTestId('view-chat')).toBeTruthy()
  })
})

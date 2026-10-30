// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { GroupKey, GroupSnapshot } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import type { TranscriptViewMode } from '../src/chat-settings.ts'
import { ProcessGroupHeader } from '../src/client/chat/ChatGroupSeat.tsx'
import type { ProcessGroupData } from '../src/client/contract/process-groups.ts'
import type { ChatViewSlotProps } from '../src/client/contract/slots.ts'
import { en } from '../src/client/locale.ts'
import { derivePresentationPolicy, type CollapseTiming, type FoldedReplies } from '../src/client/presentation-policy.ts'

afterEach(cleanup)

const t = makeTranslate(en, commonEn)

function renderHeader(data: ProcessGroupData) {
  const group = createSnapshotStore<GroupSnapshot<ProcessGroupData>>({ key: 'g' as GroupKey, members: [], data })
  const mode = createSnapshotStore<TranscriptViewMode>('standard')
  const useGroup = bindSnapshotSelector(group)
  return render(
    <ProcessGroupHeader groupKey={'g' as GroupKey}
      useChatGroup={((_key: string, select: (value: GroupSnapshot<ProcessGroupData> | undefined) => unknown) => useGroup(select)) as ChatViewSlotProps['useChatGroup']}
      usePresentation={bindSnapshotSelector(derivePresentationPolicy(mode, createSnapshotStore<CollapseTiming>('completion'), createSnapshotStore<FoldedReplies>('all')))}
      t={t} open={false} bodyId="body" toggle={() => {}} />,
  )
}

const summary = { running: undefined, runningDetail: '' }

describe('ProcessGroupHeader diff stat', () => {
  it('states the closed file work and renders added and removed lines beside it', () => {
    const view = renderHeader({
      turn: 1, closed: true,
      summary: { ...summary, counts: [{ kind: 'edit', count: 1, targets: ['locales.ts'] }], added: 6, removed: 0 },
    })
    expect(view.getByText('Edited locales.ts')).toBeTruthy()
    expect(view.container.querySelector('[class*="diffAdded"]')?.textContent).toBe('+6')
    expect(view.container.querySelector('[class*="diffRemoved"]')?.textContent).toBe('−0')
  })

  it('omits the diff stat when the closed group changed no lines', () => {
    const view = renderHeader({
      turn: 1, closed: true,
      summary: { ...summary, counts: [{ kind: 'read', count: 1, targets: ['notes.md'] }], added: 0, removed: 0 },
    })
    expect(view.container.querySelector('[class*="diffStat"]')).toBeNull()
  })

  it('omits the diff stat while the group is still open', () => {
    const view = renderHeader({
      turn: 1, closed: false,
      summary: { ...summary, counts: [{ kind: 'write', count: 1, targets: ['new.ts'] }], added: 3, removed: 0 },
    })
    expect(view.container.querySelector('[class*="diffStat"]')).toBeNull()
  })
})

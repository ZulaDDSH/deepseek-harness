// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { useSectionDialogs } from '../src/client/rows/SectionDialogs.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)
const t = makeTranslate(zh, commonZh)
const sections = [{ id: 'work', name: 'Work' }]

function mount() {
  const createSection = vi.fn()
  const renameSection = vi.fn()
  const deleteSection = vi.fn()
  const expandSection = vi.fn()
  function Harness({ items = sections }) {
    const dialogs = useSectionDialogs({ sections: items, createSection, renameSection, deleteSection, expandSection, newSectionId: () => 'new', t })
    return <>
      <button onClick={dialogs.onCreateRequest}>Create section</button>
      <button onClick={() => { dialogs.onRenameRequest('work', 'Work') }}>Rename section</button>
      <button onClick={() => { dialogs.onDeleteRequest('work', 'Work') }}>Delete section</button>
      {dialogs.dialogs}
    </>
  }
  return { ...render(<Harness />), Harness, createSection, renameSection, deleteSection, expandSection }
}

describe('Chat Section dialogs', () => {
  it('rejects empty names and waits for IME composition before creating', () => {
    const b = mount()
    fireEvent.click(screen.getByText('Create section'))
    const input = screen.getByRole('textbox')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(b.createSection).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: '  Work  ' } })
    fireEvent.compositionStart(input)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(b.createSection).not.toHaveBeenCalled()
    fireEvent.compositionEnd(input)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(b.createSection).toHaveBeenCalledWith({ id: 'new', name: 'Work' })
    expect(b.expandSection).toHaveBeenCalledWith('new')
  })

  it('cancels creation through its button and Escape', () => {
    const b = mount()
    fireEvent.click(screen.getByText('Create section'))
    fireEvent.click(screen.getByRole('button', { name: commonZh.cancel }))
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByText('Create section'))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(b.createSection).not.toHaveBeenCalled()
  })

  it('rejects unchanged rename drafts and saves a changed name', () => {
    const b = mount()
    fireEvent.click(screen.getByText('Rename section'))
    const input = screen.getByRole('textbox')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(b.renameSection).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.change(input, { target: { value: 'Renamed' } })
    fireEvent.click(screen.getByRole('button', { name: t('rename') }))
    expect(b.renameSection).toHaveBeenCalledWith('work', 'Renamed')
  })

  it('cancels rename through its button and Escape', () => {
    mount()
    fireEvent.click(screen.getByText('Rename section'))
    fireEvent.click(screen.getByRole('button', { name: commonZh.cancel }))
    fireEvent.click(screen.getByText('Rename section'))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('cancels deletion or deletes only the addressed section', () => {
    const b = mount()
    fireEvent.click(screen.getByText('Delete section'))
    fireEvent.click(screen.getByRole('button', { name: commonZh.cancel }))
    expect(b.deleteSection).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('Delete section'))
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(screen.getByText('Delete section'))
    fireEvent.click(screen.getByRole('button', { name: zh['section.delete'] }))
    expect(b.deleteSection).toHaveBeenCalledWith('work')
  })

  it.each(['Rename section', 'Delete section'])('closes %s when another surface removes the section', (label) => {
    const b = mount()
    fireEvent.click(screen.getByText(label))
    expect(screen.getByRole('dialog')).toBeTruthy()
    b.rerender(<b.Harness items={[]} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(b.renameSection).not.toHaveBeenCalled()
    expect(b.deleteSection).not.toHaveBeenCalled()
  })
})

/** Browser-owned Chat Section creation, rename, and deletion interactions. */
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkspaceBrowserProps } from '../contract/slots.ts'
import css from './WorkspaceBrowser.module.css'

export interface SectionDialogController {
  dialogs: ReactNode
  /** Open the create dialog for a new section. */
  onCreateRequest: () => void
  onRenameRequest: (sectionId: string, currentName: string) => void
  onDeleteRequest: (sectionId: string, name: string) => void
}

/**
 * Own the Chat Section dialogs so a section header unmounting (a delete, a
 * collapse, a projection switch) cannot tear down an in-flight edit.
 * @param options - current section list, persistence callbacks, and locale seat.
 * @returns header action callbacks plus the dialog tree rendered by the browser root.
 */
export function useSectionDialogs(options: {
  sections: readonly { id: string; name: string }[]
  createSection: (section: { id: string; name: string }) => void
  renameSection: (sectionId: string, name: string) => void
  deleteSection: (sectionId: string) => void
  newSectionId: () => string
  /** Collapse the created section so its first dropped Chat is visible immediately. */
  expandSection: (sectionId: string) => void
  t: WorkspaceBrowserProps['t']
}): SectionDialogController {
  const {
    sections, createSection, renameSection, deleteSection, newSectionId, expandSection, t,
  } = options
  const composingRef = useRef(false)

  const [creating, setCreating] = useState(false)
  const [createDraft, setCreateDraft] = useState('')
  const [renameTarget, setRenameTarget] = useState<{ sectionId: string; currentName: string } | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const createTrimmed = createDraft.trim()
  const renameTrimmed = renameDraft.trim()
  const renameBlocked = renameTarget === null || renameTrimmed === ''
    || renameTrimmed === renameTarget.currentName

  const confirmCreate = (): void => {
    if (createTrimmed === '') return
    const id = newSectionId()
    createSection({ id, name: createTrimmed })
    expandSection(id)
    setCreating(false)
    setCreateDraft('')
  }
  const confirmRename = (): void => {
    if (renameBlocked) return
    renameSection(renameTarget.sectionId, renameTrimmed)
    setRenameTarget(null)
  }

  const [deleteTarget, setDeleteTarget] = useState<{ sectionId: string; name: string } | null>(null)
  const closeDelete = (): void => { setDeleteTarget(null) }
  const confirmDelete = (): void => {
    if (deleteTarget === null) return
    // Deleting a section never deletes its Chats: the store drops only the
    // grouping, so every member returns to the ungrouped list.
    deleteSection(deleteTarget.sectionId)
    setDeleteTarget(null)
  }

  // A section deleted elsewhere (another surface, a reload of the projected
  // list) must not leave its rename or delete dialog addressing a dead id.
  useEffect(() => {
    if (renameTarget !== null && !sections.some(section => section.id === renameTarget.sectionId)) {
      setRenameTarget(null)
    }
    if (deleteTarget !== null && !sections.some(section => section.id === deleteTarget.sectionId)) {
      setDeleteTarget(null)
    }
  }, [deleteTarget, renameTarget, sections])

  const nameInput = (
    value: string,
    onChange: (next: string) => void,
    onConfirm: () => void,
    disabled: boolean,
  ) => (
    <input
      className={css.renameInput}
      value={value}
      aria-label={t('section.field.name')}
      data-modal-autofocus
      disabled={disabled}
      onFocus={(event) => { event.target.select() }}
      onChange={(event) => { onChange(event.target.value) }}
      onCompositionStart={() => { composingRef.current = true }}
      onCompositionEnd={() => { composingRef.current = false }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !composingRef.current) {
          event.preventDefault()
          onConfirm()
        }
      }}
    />
  )

  const dialogs = (
    <>
      <Modal
        open={creating}
        onClose={() => { setCreating(false) }}
        closeLabel={t('close')}
        title={t('section.create.title')}
        footer={(
          <>
            <Button variant="outline" onClick={() => { setCreating(false) }}>{t('cancel')}</Button>
            <Button variant="primary" disabled={createTrimmed === ''} onClick={confirmCreate}>{t('section.create')}</Button>
          </>
        )}
      >
        {nameInput(createDraft, setCreateDraft, confirmCreate, false)}
      </Modal>

      <Modal
        open={renameTarget !== null}
        onClose={() => { setRenameTarget(null) }}
        closeLabel={t('close')}
        title={t('section.rename.title')}
        footer={(
          <>
            <Button variant="outline" onClick={() => { setRenameTarget(null) }}>{t('cancel')}</Button>
            <Button variant="primary" disabled={renameBlocked} onClick={confirmRename}>{t('rename')}</Button>
          </>
        )}
      >
        {nameInput(renameDraft, setRenameDraft, confirmRename, false)}
      </Modal>

      <Modal
        open={deleteTarget !== null}
        onClose={closeDelete}
        closeLabel={t('close')}
        title={t('section.delete')}
        {...deleteTarget === null ? {} : { description: t('section.delete.desc', { name: deleteTarget.name }) }}
        footer={(
          <>
            <Button variant="outline" onClick={closeDelete}>{t('cancel')}</Button>
            <Button variant="outline" className={css.deleteAction} onClick={confirmDelete}>
              {t('section.delete')}
            </Button>
          </>
        )}
      />
    </>
  )

  return {
    dialogs,
    onCreateRequest: () => { setCreateDraft(''); setCreating(true) },
    onRenameRequest: (sectionId, currentName) => {
      setRenameTarget({ sectionId, currentName })
      setRenameDraft(currentName)
    },
    onDeleteRequest: (sectionId, name) => { setDeleteTarget({ sectionId, name }) },
  }
}

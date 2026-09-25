/**
 * Browser-owned Workspace rename and deletion dialogs. Session verbs are row
 * action slot entries with their own surfaces, so none of them live here.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { WorkspaceBrowserProps } from '../contract/slots.ts'
import css from './WorkspaceBrowser.module.css'

/** The dialog tree plus the two row requests that open it. */
export interface WorkspaceDialogController {
  dialogs: ReactNode
  /** Open the rename dialog seeded with the label on screen. */
  onWorkspaceRename: (workspaceId: WorkspaceId, displayTitle: string) => void
  onWorkspaceDelete: (workspaceId: WorkspaceId, title: string) => void
}

/**
 * Own the browser dialogs so row unmounts cannot tear down in-flight mutations.
 * @param options - displayed and stored Workspace projections, mutation callbacks, and locale seat.
 * @returns row action callbacks plus the dialog tree rendered by the browser root.
 */
export function useWorkspaceDialogs(options: {
  /** Workspaces with their display titles (the automatic title localized). */
  workspaces: readonly WorkspaceView[]
  /** Workspaces as stored; a rename compares against the stored title. */
  storedWorkspaces: readonly WorkspaceView[]
  renameWorkspace: WorkspaceBrowserProps['renameWorkspace']
  deleteWorkspace: WorkspaceBrowserProps['deleteWorkspace']
  t: WorkspaceBrowserProps['t']
}): WorkspaceDialogController {
  const { workspaces, storedWorkspaces, renameWorkspace, deleteWorkspace, t } = options
  const composingRef = useRef(false)

  // The stored title decides whether confirming is a real rename; the draft is
  // seeded with the label on screen. They differ for a Workspace still
  // carrying its automatic title, so confirming the prefill pins that name.
  const [renameTarget, setRenameTarget] = useState<{ workspaceId: WorkspaceId; storedTitle: string } | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [renameError, setRenameError] = useState<string | null>(null)
  const renameTrimmed = renameDraft.trim()
  // Self is excluded by identity, not by title: the draft is seeded with the
  // localized label, which for an automatically titled Workspace equals its
  // own displayed title without being a conflict with itself.
  const renameDuplicate = renameTarget !== null && renameTrimmed !== ''
    && workspaces.some(workspace => workspace.workspaceId !== renameTarget.workspaceId && workspace.title === renameTrimmed)
  const renameBlocked = renaming || renameTrimmed === ''
    || renameTarget === null || renameTrimmed === renameTarget.storedTitle || renameDuplicate
  const closeRename = (): void => {
    if (renaming) return
    setRenameTarget(null)
    setRenameError(null)
  }
  const confirmRename = (): void => {
    // renameBlocked already includes renameTarget === null; re-checking it here
    // would be a branch the types prove unreachable.
    if (renameBlocked) return
    setRenaming(true)
    setRenameError(null)
    renameWorkspace(renameTarget.workspaceId, renameTrimmed).then(() => {
      setRenaming(false)
      setRenameTarget(null)
    }).catch((reason: unknown) => {
      setRenaming(false)
      setRenameError(reason instanceof Error ? reason.message : String(reason))
    })
  }

  const [deleteTarget, setDeleteTarget] = useState<{ workspaceId: WorkspaceId; title: string } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteCommittedId, setDeleteCommittedId] = useState<WorkspaceId | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  useEffect(() => {
    if (deleteCommittedId === null
      || workspaces.some(workspace => workspace.workspaceId === deleteCommittedId)) return
    setDeleting(false)
    setDeleteCommittedId(null)
    setDeleteTarget(null)
  }, [deleteCommittedId, workspaces])
  const closeDelete = (): void => {
    if (deleting) return
    setDeleteTarget(null)
    setDeleteError(null)
  }
  const confirmDelete = (): void => {
    if (deleting || deleteTarget === null) return
    setDeleting(true)
    setDeleteCommittedId(null)
    setDeleteError(null)
    deleteWorkspace(deleteTarget.workspaceId).then(() => {
      setDeleteCommittedId(deleteTarget.workspaceId)
    }).catch((reason: unknown) => {
      setDeleting(false)
      setDeleteError(reason instanceof Error ? reason.message : String(reason))
    })
  }

  const onWorkspaceRename = (workspaceId: WorkspaceId, displayTitle: string): void => {
    setRenameTarget({
      workspaceId,
      storedTitle: storedWorkspaces.find(workspace => workspace.workspaceId === workspaceId)?.title ?? displayTitle,
    })
    setRenameDraft(displayTitle)
    setRenameError(null)
  }
  const onWorkspaceDelete = (workspaceId: WorkspaceId, title: string): void => {
    setDeleteTarget({ workspaceId, title })
    setDeleteError(null)
  }

  const dialogs = (
    <>
      <Modal
        open={renameTarget !== null}
        onClose={closeRename}
        closeLabel={t('close')}
        title={t('rename.workspace.title')}
        footer={(
          <>
            <Button variant="outline" disabled={renaming} onClick={closeRename}>{t('cancel')}</Button>
            <Button variant="primary" disabled={renameBlocked} onClick={confirmRename}>{t('rename')}</Button>
          </>
        )}
      >
        <input
          className={css.renameInput}
          value={renameDraft}
          aria-label={t('field.workspaceName')}
          data-modal-autofocus
          disabled={renaming}
          onFocus={(event) => { event.target.select() }}
          onChange={(event) => { setRenameDraft(event.target.value); setRenameError(null) }}
          onCompositionStart={() => { composingRef.current = true }}
          onCompositionEnd={() => { composingRef.current = false }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !composingRef.current) {
              event.preventDefault()
              confirmRename()
            }
          }}
        />
        {renameDuplicate && (
          <div className={css.renameError} role="alert">{t('conflict.named', { name: renameTrimmed })}</div>
        )}
        {renameError !== null && <div className={css.renameError} role="alert">{renameError}</div>}
      </Modal>

      <Modal
        open={deleteTarget !== null}
        onClose={closeDelete}
        closeLabel={t('close')}
        title={t('delete.workspace')}
        {...deleteTarget === null
          ? {}
          : { description: t('delete.desc', { name: deleteTarget.title }) }}
        footer={(
          <>
            <Button variant="outline" disabled={deleting} onClick={closeDelete}>{t('cancel')}</Button>
            <Button
              variant="outline"
              className={css.deleteAction}
              disabled={deleting}
              onClick={confirmDelete}
            >
              {t('delete.workspace')}
            </Button>
          </>
        )}
      >
        {deleting && <div className={css.deleteStatus} role="status">{t('delete.pending')}</div>}
        {deleteError !== null && <div className={css.renameError} role="alert">{deleteError}</div>}
      </Modal>
    </>
  )

  return { dialogs, onWorkspaceRename, onWorkspaceDelete }
}

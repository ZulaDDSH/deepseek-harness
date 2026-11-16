import { useEffect, useId, useRef, useState } from 'react'
import { resolveWorkspacePath } from '@deepseek-ai/dsh-util-workspace-path'
import { FileTypeIcon, HoverCard, Menu, MenuItemButton } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, SessionStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { changesDiffUrl, type ChangesSummary } from '../changes.ts'
import type { DeliverablesInjected } from './Deliverables.tsx'
import { FileDiff } from './FileDiff.tsx'
import diffCss from './FileDiff.module.css'
import { basename } from './turn-deliverables.ts'
import type { NS } from './locales.ts'
import css from './ChangedFiles.module.css'

type PreviewProps = Pick<InjectFace<DeliverablesInjected>, 'useChangesDiff' | 'loadChangesDiff'>
  & Pick<SessionStandardProps, 'sessionId'>

const GROUPED = new Intl.NumberFormat('en-US')

/** Added and deleted line counts in the card's colors. */
function Counts({ added, deleted, t }: { added: number; deleted: number } & PropsLocale<typeof NS>) {
  return <>
    <span className={css.added}>{t('changes.added', { count: GROUPED.format(added) })}</span>
    <span className={css.deleted}>{t('changes.deleted', { count: GROUPED.format(deleted) })}</span>
  </>
}

export function ChangedFiles({ changes, cwd, openReview, t, sessionId, useChangesDiff, loadChangesDiff, compact = false }: {
  /** The served summary with the sequence of the event that announced it. */
  changes: Pick<ChangesSummary, 'files' | 'total' | 'added' | 'deleted'> & { seq: number }
  cwd: string | undefined
  compact?: boolean
  /** Open the turn's review on the file at an original summary index. */
  openReview: (index: number) => void
} & PropsLocale<typeof NS> & PreviewProps) {
  const cardRef = useRef<HTMLDivElement>(null)
  const pathDescriptionId = useId()
  const [open, setOpen] = useState(false)
  const onlyFile = changes.total === 1 ? changes.files[0] : undefined
  const singleFile = compact ? undefined : onlyFile
  const title = onlyFile === undefined ? t('changes.title', { count: String(changes.total) })
    : t('changes.singleTitle', { name: basename(onlyFile.path) })
  const header = <button type="button" className={css.header}
    aria-label={singleFile === undefined ? title : t('changes.viewDiff', { name: singleFile.display })}
    aria-haspopup={singleFile === undefined ? 'menu' : undefined}
    aria-expanded={singleFile === undefined ? open : undefined}
    aria-describedby={singleFile === undefined ? undefined : pathDescriptionId}
    onClick={() => { if (singleFile === undefined) setOpen(value => !value); else openReview(0) }}>
    <span className={css.tile}>
      {singleFile === undefined ? <FileTypeIcon kind="code" size={20} /> : <FileTypeIcon path={singleFile.path} size={20} />}
    </span>
    <span className={css.titles}>
      <span className={css.title}>{title}</span>
      <span className={css.stat}>
        <span className={css.statCounts}>{singleFile?.binary === true ? t('changes.binary')
          : singleFile?.oversized === true ? t('changes.oversized')
            : <Counts t={t} added={changes.added} deleted={changes.deleted} />}</span>
        <span className={css.previewHint}>{t('presented.preview')}</span>
      </span>
    </span>
  </button>
  return <div ref={cardRef} className={css.card} data-changed-files data-single={singleFile !== undefined || undefined}>
    {singleFile === undefined ? <Menu open={open} anchor={header} portal side="top" align="end" compact
      onClose={() => { setOpen(false) }}>
      {changes.files.map((file, index) => (
        <MenuItemButton key={file.display} onSelect={() => { setOpen(false); openReview(index) }}>
          <HoverCard variant="preview" openDelayMs={500}
            content={<div onPointerDown={(event) => { event.stopPropagation() }} onClick={(event) => { event.stopPropagation() }}>
              <ChangedFilePreview sessionId={sessionId} seq={changes.seq} index={index}
                display={resolveWorkspacePath(cwd, file.path)} useChangesDiff={useChangesDiff} loadChangesDiff={loadChangesDiff} t={t} />
            </div>}
            anchor={<span className={css.menuRow}>
              <span className={css.path}>{file.display}</span>
              <span className={css.counts}>
                {file.binary === true ? t('changes.binary') : file.oversized === true ? t('changes.oversized')
                  : <Counts t={t} added={file.added} deleted={file.deleted} />}
              </span>
            </span>} />
        </MenuItemButton>
      ))}
    </Menu> : <>
      <HoverCard variant="preview" widthAnchorRef={cardRef} openDelayMs={500} anchor={header}
        content={<ChangedFilePreview sessionId={sessionId} seq={changes.seq} index={0}
          display={resolveWorkspacePath(cwd, singleFile.path)} useChangesDiff={useChangesDiff}
          loadChangesDiff={loadChangesDiff} t={t} />} />
      <span id={pathDescriptionId} hidden>{resolveWorkspacePath(cwd, singleFile.path)}</span>
    </>}
  </div>
}

/** Mounted only while its hover card is open, so passing over a row does not read a comparison. */
function ChangedFilePreview({ sessionId, seq, index, display, useChangesDiff, loadChangesDiff, t }: PreviewProps & {
  seq: number
  index: number
  display: string
} & PropsLocale<typeof NS>) {
  const state = useChangesDiff(value => value[changesDiffUrl(sessionId, seq, index)])
  useEffect(() => {
    if (state === undefined) void loadChangesDiff(sessionId, seq, index)
  }, [state, sessionId, seq, index, loadChangesDiff])
  return <div className={`${diffCss.root} ${css.preview}`} data-changes-hover-preview>
    <div className={diffCss.header}><span className={css.previewPath} data-changes-preview-path>{display}</span></div>
    <FileDiff state={state} split={false} wrap={false} t={t} retry={() => { void loadChangesDiff(sessionId, seq, index) }} />
  </div>
}

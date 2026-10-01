/** Local memory records, document import and an interactive context graph. */
import { useEffect, useState, type ReactNode } from 'react'
import { IconDataOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { MemorixCell, MemorixPage, MemorixTable, MemoryGraph, MemoryImportResult } from '../types.ts'
import { bytesToBase64 } from '@deepseek-ai/dsh-util-crypto'
import { NS } from './locales.ts'
import css from './MemoryPage.module.css'

type MemoryRemote = ClientRemote['memoryWorkspace']
type PageProps = PropsRuntime<'main'> & PropsLocale<typeof NS> & InjectFace<{ memory: MemoryRemote }>

function answer<T>(result: RemoteResult<T>): T {
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

function cellText(value: MemorixCell | undefined): string {
  return typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '')
}

/**
 * Render the memory sidebar icon.
 * @param props - sidebar icon dimensions.
 * @returns the memory glyph.
 */
export function MemoryIcon({ size }: PropsRuntime<'sidebar.panellist'>): ReactNode {
  return <IconDataOutlineRegular size={size} />
}

/**
 * Browse actual local memory data and import user-selected documents.
 * @param props - localized copy and authenticated memory methods.
 * @returns the complete memory workspace.
 */
export function MemoryPage({ memory, t }: PageProps): ReactNode {
  const [tables, setTables] = useState<MemorixTable[]>([])
  const [table, setTable] = useState('observations')
  const [query, setQuery] = useState('')
  const [offset, setOffset] = useState(0)
  const [page, setPage] = useState<MemorixPage | null>(null)
  const [detail, setDetail] = useState('')
  const [graph, setGraph] = useState<MemoryGraph | null>(null)
  const [tab, setTab] = useState<'browse' | 'graph'>('browse')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [imports, setImports] = useState<MemoryImportResult[]>([])
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    let active = true
    setBusy(true)
    setError('')
    const load = async (): Promise<void> => {
      try {
        if (tab === 'browse') {
          const [inventory, rows] = await Promise.all([memory.inventory(), memory.page(table, offset, query)])
          if (active) { setTables(answer(inventory)); setPage(answer(rows)); setDetail('') }
        } else {
          const data = await memory.graph()
          if (active) setGraph(answer(data))
        }
      } catch (failure) {
        if (active) setError(failure instanceof Error ? failure.message : String(failure))
      } finally { if (active) setBusy(false) }
    }
    void load()
    return () => { active = false }
  }, [memory, table, offset, query, tab, revision])

  const upload = async (files: FileList): Promise<void> => {
    setBusy(true)
    setError('')
    const outcomes: MemoryImportResult[] = []
    setImports([])
    setUploading(true)
    try {
      for (const file of Array.from(files)) {
        const bytes = new Uint8Array(await file.arrayBuffer())
        outcomes.push(answer(await memory.importDocument(file.name, bytesToBase64(bytes))))
        setImports([...outcomes])
      }

    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
    finally {
      if (outcomes.some(result => result.completed > 0)) setRevision(value => value + 1)
      setBusy(false)
      setUploading(false)
    }
  }

  return <section className={css.page} data-memory-workspace>
    <header><h1>{t('title')}</h1><button disabled={busy} onClick={() =>{  setRevision(value => value + 1) }}>{t('refresh')}</button></header>
    <nav>
      <button aria-pressed={tab === 'browse'} onClick={() =>{  setTab('browse') }}>{t('browse')}</button>
      <button aria-pressed={tab === 'graph'} onClick={() =>{  setTab('graph') }}>{t('graph')}</button>
    </nav>
    {busy && <p role="status">{uploading ? t('importing') : t('loading')}</p>}
    {error && <p role="alert">{error}</p>}
    {tab === 'browse' ? <>
      <p>{t('allScope')}</p>
      <div className={css.controls}>
        <select aria-label={t('browse')} value={table} disabled={busy} onChange={(event) => { setTable(event.target.value); setOffset(0) }}>
          {tables.map(item => <option key={item.name} value={item.name}>{item.name} ({item.count})</option>)}
        </select>
        <input aria-label={t('search')} placeholder={t('search')} value={query} onChange={(event) => { setQuery(event.target.value); setOffset(0) }} />
      </div>
      <div className={css.records}>
        <div className={css.list}>
          {page?.rows.map((row, index) => <button key={index} className={css.record}
            onClick={() => { setDetail(JSON.stringify(row, null, 2)) }}>
            <strong>{cellText(row.title ?? row.name ?? row.id ?? offset + index + 1)}</strong>
            <span>{cellText(row.projectId ?? row.originProjectId ?? row.project_id)}</span>
            <span>{cellText(row.status ?? row.state ?? row.type)}</span>
          </button>)}
          {page?.total === 0 && <p>{t('empty')}</p>}
        </div>
        <aside><h2>{t('detail')}</h2><pre>{detail}</pre></aside>
      </div>
      <div className={css.controls}>
        <button disabled={busy || offset === 0} onClick={() =>{  setOffset(Math.max(0, offset - (page?.limit ?? 0))) }}>{t('previous')}</button>
        <span>{t('total')}: {page?.total ?? 0}</span>
        <button disabled={busy || page === null || page.rows.length === 0 || offset + page.rows.length >= page.total} onClick={() =>{  setOffset(offset + (page?.rows.length ?? 0)) }}>{t('next')}</button>
      </div>
      <div className={css.upload}>
        <h2>{t('upload')}</h2><p>{t('importInfo')}</p>
        <label>{t('textFormats')}<input type="file" multiple accept=".txt,.md,.csv,.json,.log,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx" disabled={busy} onChange={(event) => {
          if (event.target.files !== null) void upload(event.target.files)
          event.target.value = ''
        }} /></label>
        {imports.map((result, index) => <p key={index} role="status">{result.filename}: {t('imported')} {result.completed}/{result.total} {result.error ?? ''}</p>)}
      </div>
    </> : <>
      {graph === null && <p>{t('graphMissing')}</p>}
      {graph && <iframe className={css.graph} title={t('graph')} sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={graph.html} />}
      {graph && <p>{t('source')}: {graph.path}</p>}
    </>}
  </section>
}

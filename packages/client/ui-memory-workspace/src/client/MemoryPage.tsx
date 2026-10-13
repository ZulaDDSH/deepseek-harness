/** Local memory records, document import and an interactive context graph. */
import { useEffect, useState, type ReactNode } from 'react'
import { IconDataOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { MemorixCell, MemorixPage, MemorixTable, MemorixView, MemoryGraph, MemoryImportResult } from '../types.ts'
import { bytesToBase64 } from '@deepseek-ai/dsh-util-crypto'
import { NS } from './locales.ts'
import css from './MemoryPage.module.css'

type MemoryRemote = ClientRemote['memoryWorkspace']
type PageProps = PropsRuntime<'main'> & PropsLocale<typeof NS> & InjectFace<{ memory: MemoryRemote }>
type Row = MemorixPage['rows'][number]

const SEARCH_DELAY_MS = 300
const MEMORY_TABLES = ['observations', 'long_term_memories', 'mini_skills', 'sessions']

function answer<T>(result: RemoteResult<T>): T {
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

function cellText(value: MemorixCell | undefined): string {
  return typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '')
}

function rowLabel(row: Row, position: number): string {
  return cellText(row.title ?? row.name ?? row.id) || String(position)
}

function rowMeta(row: Row): string {
  const date = cellText(row.createdAt ?? row.updatedAt).slice(0, 10)
  return [row.type, row.projectId ?? row.originProjectId ?? row.project_id, row.status ?? row.state, date]
    .map(cellText).filter(part => part !== '').join(' · ')
}

function ordered(tables: MemorixTable[]): MemorixTable[] {
  const rank = (name: string): number => { const index = MEMORY_TABLES.indexOf(name); return index < 0 ? MEMORY_TABLES.length : index }
  return [...tables].sort((a, b) => rank(a.name) - rank(b.name))
}

function reason(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure)
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
  const [tables, setTables] = useState<MemorixTable[] | null>(null)
  const [table, setTable] = useState('observations')
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [view, setView] = useState<MemorixView>('all')
  const [offset, setOffset] = useState(0)
  const [page, setPage] = useState<MemorixPage | null>(null)
  const [selected, setSelected] = useState<Row | null>(null)
  const [graph, setGraph] = useState<MemoryGraph | null>(null)
  const [tab, setTab] = useState<'browse' | 'graph'>('browse')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [imports, setImports] = useState<MemoryImportResult[]>([])
  const [revision, setRevision] = useState(0)
  const [importError, setImportError] = useState('')
  const limit = page?.limit ?? 0
  const shown = page?.rows.length ?? 0
  const unavailable = error !== '' && tables === null
  const filterable = tables?.find(item => item.name === table)?.columns.includes('topicKey') === true

  useEffect(() => {
    if (search === query) return undefined
    const timer = setTimeout(() => { setQuery(search); setOffset(0) }, SEARCH_DELAY_MS)
    return () => { clearTimeout(timer) }
  }, [search, query])

  useEffect(() => {
    if (tab !== 'browse') return undefined
    let active = true
    setBusy(true)
    setError('')
    const load = async (): Promise<void> => {
      try {
        const inventory = ordered(answer(await memory.inventory()))
        if (active) setTables(inventory)
      } catch (failure) {
        if (active) { setTables(null); setPage(null); setError(reason(failure)); setBusy(false) }
      }
    }
    void load()
    return () => { active = false }
  }, [memory, tab, revision])

  useEffect(() => {
    if (tab !== 'browse' || tables === null) return undefined
    let active = true
    setBusy(true)
    setError('')
    const load = async (): Promise<void> => {
      try {
        const target = tables.length === 0 || tables.some(item => item.name === table) ? table : (tables[0]?.name ?? table)
        if (target !== table) { setTable(target); return }
        const rows = answer(await memory.page(table, offset, query, view))
        if (active) { setPage(rows); setSelected(null) }
      } catch (failure) {
        if (active) setError(reason(failure))
      } finally { if (active) setBusy(false) }
    }
    void load()
    return () => { active = false }
  }, [memory, tables, table, offset, query, view, tab])

  useEffect(() => {
    if (tab !== 'graph') return undefined
    let active = true
    setBusy(true)
    setError('')
    const load = async (): Promise<void> => {
      try {
        const data = answer(await memory.graph())
        if (active) setGraph(data)
      } catch (failure) {
        if (active) { setGraph(null); setError(reason(failure)) }
      } finally { if (active) setBusy(false) }
    }
    void load()
    return () => { active = false }
  }, [memory, tab, revision])

  const upload = async (files: FileList): Promise<void> => {
    setBusy(true)
    setImportError('')
    const outcomes: MemoryImportResult[] = []
    setImports([])
    setUploading(true)
    try {
      for (const file of Array.from(files)) {
        const bytes = new Uint8Array(await file.arrayBuffer())
        outcomes.push(answer(await memory.importDocument(file.name, bytesToBase64(bytes))))
        setImports([...outcomes])
      }
    } catch (failure) { setImportError(reason(failure)) }
    finally {
      if (outcomes.some(result => result.completed > 0)) setRevision(value => value + 1)
      setBusy(false)
      setUploading(false)
    }
  }

  const choose = (next: MemorixView): void => { setView(next); setOffset(0) }
  const views: [MemorixView, string][] = [['all', t('viewAll')], ['memories', t('viewMemories')], ['documents', t('viewDocuments')]]

  return <section className={css.page} data-memory-workspace>
    <header><h1>{t('title')}</h1><button disabled={busy} onClick={() => { setRevision(value => value + 1) }}>{t('refresh')}</button></header>
    <nav>
      <button aria-pressed={tab === 'browse'} onClick={() => { setTab('browse') }}>{t('browse')}</button>
      <button aria-pressed={tab === 'graph'} onClick={() => { setTab('graph') }}>{t('graph')}</button>
    </nav>
    {busy && <p role="status">{uploading ? t('importing') : tab === 'graph' ? t('graphBuilding') : t('loading')}</p>}
    {error && <p role="alert">{error}</p>}
    {unavailable && <p className={css.hint}>{t('setupHint')}</p>}
    {tab === 'browse' ? unavailable ? null : <>
      <p>{t('allScope')}</p>
      <div className={css.controls}>
        <select aria-label={t('browse')} value={table} disabled={busy} onChange={(event) => { setTable(event.target.value); setOffset(0) }}>
          {(tables ?? []).map(item => <option key={item.name} value={item.name}>{item.name} ({item.count})</option>)}
        </select>
        <input aria-label={t('search')} placeholder={t('search')} value={search} onChange={(event) => { setSearch(event.target.value) }}
          onKeyDown={(event) => { if (event.key === 'Enter') { setQuery(search); setOffset(0) } }} />
        {filterable && <div role="group" aria-label={t('view')} className={css.views}>
          {views.map(([value, label]) => <button key={value} aria-pressed={view === value}
            onClick={() => { choose(value) }}>{label}</button>)}
        </div>}
      </div>
      <div className={css.records}>
        <div className={css.list}>
          {page?.rows.map((row, index) => <button key={`${offset}:${index}`} className={css.record} aria-current={row === selected}
            onClick={() => { setSelected(row) }}>
            <strong>{rowLabel(row, offset + index + 1)}</strong>
            <span>{rowMeta(row)}</span>
          </button>)}
          {page !== null && page.total === 0 && !busy && <p>{query === '' ? t('empty') : <>{t('noMatch')} “{query}”</>}</p>}
        </div>
        <aside><h2>{t('detail')}</h2>
          {selected === null ? <p>{t('selectRecord')}</p> : <dl>
            {Object.entries(selected).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{cellText(value)}</dd></div>)}
          </dl>}
        </aside>
      </div>
      <div className={css.controls}>
        <button disabled={busy || offset === 0} onClick={() => { setOffset(Math.max(0, offset - limit)) }}>{t('previous')}</button>
        <span>{page === null ? '' : shown === 0 ? `${t('total')}: ${page.total}` : `${offset + 1}–${offset + shown} ${t('of')} ${page.total}`}</span>
        <button disabled={busy || page === null || shown === 0 || offset + shown >= page.total} onClick={() => { setOffset(offset + shown) }}>{t('next')}</button>
      </div>
      <div className={css.upload}>
        <h2>{t('upload')}</h2><p>{t('importInfo')}</p>
        <label>{t('textFormats')}<input type="file" multiple accept=".txt,.md,.csv,.json,.log,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx" disabled={busy} onChange={(event) => {
          if (event.target.files !== null) void upload(event.target.files)
          event.target.value = ''
        }} /></label>
        {imports.map((result, index) => <p key={index} role="status">{result.filename}: {t('imported')} {result.completed}/{result.total} {result.error ?? ''}</p>)}
        {importError && <p role="alert">{importError}</p>}
      </div>
    </> : <>
      {(graph === null ? !busy && !error : graph.documents === 0) && <p>{t('graphMissing')}</p>}
      {graph !== null && graph.documents > 0 && <>
        <iframe className={css.graph} title={t('graph')} sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={graph.html} />
        <p>{t('source')}: {graph.path}</p>
      </>}
    </>}
  </section>
}

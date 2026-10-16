/** Local memory records, document import and an interactive context graph. */
import { useEffect, useState, type DragEvent, type ReactNode } from 'react'
import {
  Button, IconChevronLeftOutlineRegular, IconChevronRightOutlineRegular, IconDataOutlineRegular, IconPaperclipOutlineRegular,
  IconSearchOutlineRegular, Input, SegmentedControl, StateDot, Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SegmentedControlOption } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { MemorixCell, MemorixPage, MemorixTable, MemorixView, MemoryGraph, MemoryImportResult, MemoryStatus } from '../types.ts'
import { bytesToBase64 } from '@deepseek-ai/dsh-util-crypto'
import { NS } from './locales.ts'
import css from './MemoryPage.module.css'

type MemoryRemote = ClientRemote['memoryWorkspace']
type PageProps = PropsRuntime<'main'> & PropsLocale<typeof NS> & InjectFace<{ memory: MemoryRemote }>
type Row = MemorixPage['rows'][number]

const SEARCH_DELAY_MS = 300
const STARTING_POLL_MS = 1500
const MEMORY_TABLES = ['observations', 'long_term_memories', 'mini_skills', 'sessions']

function answer<T>(result: RemoteResult<T>): T {
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

function cellText(value: MemorixCell | undefined): string {
  return typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '')
}

const FIELD_KEYS = [
  'id', 'title', 'name', 'type', 'entityName', 'narrative', 'facts', 'concepts', 'filesModified', 'commandsRun', 'project', 'projectId',
  'originProjectId', 'status', 'state', 'topicKey', 'source', 'sessionId', 'createdAt', 'updatedAt',
] as const
type FieldKey = typeof FIELD_KEYS[number]
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/

function isFieldKey(key: string): key is FieldKey {
  return (FIELD_KEYS as readonly string[]).includes(key)
}

function humanize(key: string): string {
  const words = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim().toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function stringList(value: MemorixCell | undefined): string[] | null {
  let parsed: unknown = value
  if (typeof value === 'string' && value.startsWith('[')) {
    try { parsed = JSON.parse(value) } catch { return null }
  }
  return Array.isArray(parsed) && parsed.length > 0 && parsed.every(item => typeof item === 'string') ? parsed : null
}

function rowLabel(row: Row, position: number): string {
  return cellText(row.title ?? row.name ?? row.id) || String(position)
}

function rowType(row: Row): string {
  return cellText(row.type)
}

function rowMeta(row: Row): string {
  const date = cellText(row.createdAt ?? row.updatedAt).slice(0, 10)
  return [row.projectId ?? row.originProjectId ?? row.project_id, row.status ?? row.state, date]
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
  const [dragging, setDragging] = useState(false)
  const [imports, setImports] = useState<MemoryImportResult[]>([])
  const [revision, setRevision] = useState(0)
  const [importError, setImportError] = useState('')
  const [status, setStatus] = useState<MemoryStatus | null>(null)
  const limit = page?.limit ?? 0
  const shown = page?.rows.length ?? 0
  const unavailable = error !== '' && tables === null
  const filterable = tables?.find(item => item.name === table)?.columns.includes('topicKey') === true

  useEffect(() => {
    if (search === query) return undefined
    const timer = setTimeout(() => { setQuery(search); setOffset(0) }, SEARCH_DELAY_MS)
    return () => { clearTimeout(timer) }
  }, [search, query])

  const retry = async (): Promise<void> => {
    try { setStatus(answer(await memory.retry())) } catch { setStatus(null) }
  }
  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = async (): Promise<void> => {
      try {
        const current = answer(await memory.status())
        if (!active) return
        setStatus(current)
        if (current.server === 'starting') timer = setTimeout(() => { void load() }, STARTING_POLL_MS)
      } catch {
        if (active) setStatus(null)
      }
    }
    void load()
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [memory, revision])
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

  const instant = (value: string): string => {
    const at = new Date(value)
    return ISO_INSTANT.test(value) && !Number.isNaN(at.getTime())
      ? new Intl.DateTimeFormat(t('dateLocale'), { dateStyle: 'medium', timeStyle: 'short' }).format(at) : value
  }
  const fieldLabel = (key: string): string => isFieldKey(key) ? t(`field.${key}`) : humanize(key)
  const fieldValue = (value: MemorixCell | undefined): ReactNode => {
    const items = stringList(value)
    if (items !== null) return <ul>{items.map((item, index) => <li key={index}>{item}</li>)}</ul>
    return instant(cellText(value))
  }
  const choose = (next: MemorixView): void => { setView(next); setOffset(0) }
  const dragOver = (event: DragEvent<HTMLLabelElement>): void => {
    event.preventDefault()
    if (!busy) setDragging(true)
  }
  const drop = (event: DragEvent<HTMLLabelElement>): void => {
    event.preventDefault()
    setDragging(false)
    if (!busy && event.dataTransfer.files.length > 0) void upload(event.dataTransfer.files)
  }
  const views: [MemorixView, string][] = [['all', t('viewAll')], ['memories', t('viewMemories')], ['documents', t('viewDocuments')]]
  const tabs: SegmentedControlOption<'browse' | 'graph'>[] = [{ value: 'browse', label: t('browse') }, { value: 'graph', label: t('graph') }]
  const serverDot = status?.server === 'ready' ? 'done' : status?.server === 'starting' ? 'warning' : 'error'
  const serverText = status?.server === 'ready' ? t('ready') : status?.server === 'starting' ? t('settingUp') : `${t('unavailable')}: ${status?.connection ?? ''}`

  return <section className={css.page} data-memory-workspace>
    <header className={css.header}>
      <h1 className={css.title}>{t('title')}</h1>
      <Button variant="outline" size="sm" disabled={busy} onClick={() => { setRevision(value => value + 1) }}>{t('refresh')}</Button>
    </header>
    <SegmentedControl id="memory-view" className={css.tabs} label={t('title')} value={tab} options={tabs} onChange={(next) => { setTab(next) }} />
    {status !== null && <section className={css.status} aria-label={t('chatMemory')}>
      <h2 className={css.sectionTitle}>{t('chatMemory')}</h2>
      <div className={css.statusRow}>
        <span className={css.statusState}>
          <StateDot state={serverDot} />
          <span role="status">{serverText}</span>
        </span>
        {status.server === 'unavailable' && <Button size="sm" variant="outline" onClick={() => { void retry() }}>{t('retry')}</Button>}
      </div>
      <p className={css.statusChat}>{status.chatMemory ? t('chatOn') : t('chatOff')}</p>
      <dl className={css.facts}>
        <div><dt>{t('lastSaved')}</dt><dd>{status.lastSavedAt === undefined ? t('never') : instant(status.lastSavedAt)}</dd></div>
        <div><dt>{t('lastRecalled')}</dt><dd>{status.lastRecalledAt === undefined ? t('never') : instant(status.lastRecalledAt)}</dd></div>
      </dl>
      {status.server === 'unavailable' && <p className={css.hint}>{t('unavailableHint')}</p>}
      {status.saveFailure !== undefined && <p role="alert" className={css.alert}>{t('saveFailed')} ({t('at')} {status.saveFailure.at}): {status.saveFailure.message}</p>}
      {status.recallFailure !== undefined && <p role="alert" className={css.alert}>{t('recallFailed')} ({t('at')} {status.recallFailure.at}): {status.recallFailure.message}</p>}
    </section>}
    {busy && <p role="status" className={css.caption}>{uploading ? t('importing') : tab === 'graph' ? t('graphBuilding') : t('loading')}</p>}
    {error && <p role="alert" className={css.alert}>{error}</p>}
    {unavailable && <p className={css.hint}>{t('setupHint')}</p>}
    <div role="tabpanel" id={`memory-view-${tab}-panel`} aria-labelledby={`memory-view-${tab}`} className={css.panel}>
      {tab === 'browse' ? unavailable ? null : <>
        <p className={css.caption}>{t('allScope')}</p>
        <div className={css.toolbar}>
          <select className={css.select} aria-label={t('collection')} value={table} disabled={busy} onChange={(event) => { setTable(event.target.value); setOffset(0) }}>
            {(tables ?? []).map(item => <option key={item.name} value={item.name}>{item.name} ({item.count})</option>)}
          </select>
          <Input className={css.search} icon={<IconSearchOutlineRegular size={16} />} aria-label={t('search')} placeholder={t('search')} value={search}
            onChange={(event) => { setSearch(event.target.value) }}
            onKeyDown={(event) => { if (event.key === 'Enter') { setQuery(search); setOffset(0) } }} />
          {filterable && <div role="group" aria-label={t('view')} className={css.filters}>
            {views.map(([value, label]) => <Button key={value} size="sm" variant="ghost" className={css.filter} aria-pressed={view === value}
              onClick={() => { choose(value) }}>{label}</Button>)}
          </div>}
        </div>
        <div className={css.records}>
          <div className={css.list}>
            {page?.rows.map((row, index) => <button key={`${offset}:${index}`} type="button" className={css.row} aria-current={row === selected}
              onClick={() => { setSelected(row) }}>
              <span className={css.rowTitle}>{rowLabel(row, offset + index + 1)}</span>
              <span className={css.rowMeta}>
                {rowType(row) !== '' && <Tag tone="neutral" className={css.rowTag}>{rowType(row)}</Tag>}
                <span className={css.rowText}>{rowMeta(row)}</span>
              </span>
            </button>)}
            {page !== null && page.total === 0 && !busy && <p className={css.caption}>{query === '' ? t('empty') : <>{t('noMatch')} “{query}”</>}</p>}
          </div>
          <aside className={css.detail}><h2 className={css.sectionTitle}>{t('detail')}</h2>
            {selected === null ? <div className={css.empty}>
              <span className={css.emptyIcon}><IconDataOutlineRegular size={20} /></span>
              <p>{t('selectRecord')}</p>
            </div> : <dl className={css.fields}>
              {Object.entries(selected).filter(([, value]) => value !== null && value !== '' && value !== '[]').map(([key, value]) => <div key={key}><dt>{fieldLabel(key)}</dt><dd>{fieldValue(value)}</dd></div>)}
            </dl>}
          </aside>
        </div>
        <div className={css.pager}>
          <span className={css.range}>{page === null ? '' : shown === 0 ? `${t('total')}: ${page.total}` : `${offset + 1}–${offset + shown} ${t('of')} ${page.total}`}</span>
          <Button size="sm" variant="ghost" className={css.pagerButton} aria-label={t('previous')} disabled={busy || offset === 0}
            icon={<IconChevronLeftOutlineRegular size={16} />} onClick={() => { setOffset(Math.max(0, offset - limit)) }} />
          <Button size="sm" variant="ghost" className={css.pagerButton} aria-label={t('next')}
            disabled={busy || page === null || shown === 0 || offset + shown >= page.total}
            icon={<IconChevronRightOutlineRegular size={16} />} onClick={() => { setOffset(offset + shown) }} />
        </div>
        <div className={css.upload}>
          <h2 className={css.sectionTitle}>{t('upload')}</h2><p className={css.caption}>{t('importInfo')}</p>
          <label className={css.drop} data-dragging={dragging} onDragOver={dragOver}
            onDragLeave={() => { setDragging(false) }} onDrop={drop}>
            <span className={css.dropIcon}><IconPaperclipOutlineRegular size={18} /></span>
            <span className={css.dropText}>
              <span className={css.dropHint}>{t('dropHint')}</span>
              <span className={css.formats}>{t('textFormats')}</span>
            </span>
            <input className={css.file} type="file" multiple accept=".txt,.md,.csv,.json,.log,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx" disabled={busy} onChange={(event) => {
              if (event.target.files !== null) void upload(event.target.files)
              event.target.value = ''
            }} />
          </label>
          {imports.map((result, index) => <p key={index} role="status" className={css.caption}>{result.filename}: {t('imported')} {result.completed}/{result.total} {result.error ?? ''}</p>)}
          {importError && <p role="alert" className={css.alert}>{importError}</p>}
        </div>
      </> : <>
        {(graph === null ? !busy && !error : graph.documents === 0) && <p className={css.caption}>{t('graphMissing')}</p>}
        {graph !== null && graph.documents > 0 && <>
          <iframe className={css.graph} title={t('graph')} sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={graph.html} />
          <p className={css.caption}>{t('source')}: {graph.path}</p>
        </>}
      </>}
    </div>
  </section>
}

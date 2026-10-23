import { useEffect, useMemo, useState } from 'react'
import {
  Button, Checkbox, Input, Pill, IconFolderOutlineRegular, IconSearchOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  ExternalChatCatalog, ExternalChatImportValue, ExternalChatKey,
} from '@deepseek-ai/dsh-api-session-controller/client'
import clsx from 'clsx'
import type { MasterControlPageProps } from './MasterControlPage.tsx'
import css from './MasterControlPage.module.css'

export interface ImportChatsProps extends Pick<MasterControlPageProps, 'discover' | 'importChats' | 'open' | 't'> {
  readonly visible?: boolean
  readonly setVisible?: (v: boolean) => void
}

export function ImportChats({ discover, importChats, open, t, visible, setVisible }: ImportChatsProps) {
  const [internalVisible, setInternalVisible] = useState(false)
  const isVisible = visible ?? internalVisible
  const setIsVisible = setVisible ?? setInternalVisible

  const [catalog, setCatalog] = useState<ExternalChatCatalog>()
  const [selected, setSelected] = useState<ExternalChatKey[]>([])
  const [result, setResult] = useState<ExternalChatImportValue>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')
  const [sourceFilter, setSourceFilter] = useState<'all' | 'claude' | 'codex'>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'valid' | 'error'>('all')

  const load = async () => {
    setIsVisible(true)
    setCatalog(undefined)
    setBusy(true)
    setError(undefined)
    setSelected([])
    setResult(undefined)
    try {
      setCatalog(await discover())
    } catch (failure) {
      setError(String(failure))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (visible && catalog === undefined && !busy) {
      void load()
    }
  }, [visible])

  const submit = async () => {
    setBusy(true)
    setError(undefined)
    try {
      setResult(await importChats(selected))
      setSelected([])
    } catch (failure) {
      setError(String(failure))
    } finally {
      setBusy(false)
    }
  }

  const items = catalog?.items ?? []

  const stats = useMemo(() => {
    let claude = 0
    let codex = 0
    let valid = 0
    let err = 0
    for (const item of items) {
      if (item.source.toLowerCase() === 'claude') claude++
      else if (item.source.toLowerCase() === 'codex') codex++
      if (item.error !== undefined) err++
      else valid++
    }
    return { total: items.length, claude, codex, valid, err }
  }, [items])

  const filteredItems = useMemo(() => {
    const trimmed = (typeof query === 'string' ? query : '').trim().toLowerCase()
    return items.filter((chat) => {
      if (sourceFilter !== 'all' && chat.source.toLowerCase() !== sourceFilter) return false
      if (statusFilter === 'valid' && chat.error !== undefined) return false
      if (statusFilter === 'error' && chat.error === undefined) return false
      if (trimmed) {
        const matchTitle = chat.title.toLowerCase().includes(trimmed)
        const matchCwd = (chat.cwd ?? '').toLowerCase().includes(trimmed)
        const matchPreview = chat.preview.toLowerCase().includes(trimmed)
        if (!matchTitle && !matchCwd && !matchPreview) return false
      }
      return true
    })
  }, [items, sourceFilter, statusFilter, query])

  const selectAllValid = () => {
    const validKeys = filteredItems.filter(i => i.error === undefined).map(i => i.key)
    setSelected(prev => [...new Set([...prev, ...validKeys])])
  }

  const deselectAll = () => {
    setSelected([])
  }

  if (!isVisible && visible !== undefined) return null

  return (
    <section className={css.importerCard}>
      {visible === undefined && (
        <Button size="sm" disabled={busy} onClick={() => { void load() }}>
          {t('importChats')}
        </Button>
      )}

      {isVisible && (
        <div className={css.importer} aria-busy={busy}>
          <div className={css.importerHeader}>
            <div className={css.importerTitleBlock}>
              <h3 className={css.importerTitle}>{t('importChats')}</h3>
              <p className={css.importerHelp}>{t('importHelp')}</p>
            </div>
            <div className={css.importerHeaderActions}>
              <Button size="sm" disabled={busy} onClick={() => { setIsVisible(false) }}>
                {t('close')}
              </Button>
            </div>
          </div>

          {busy && <p role="status" className={css.statusNotice}>{t('working')}</p>}
          {error !== undefined && <p role="alert" className={css.alertNotice}>{error}</p>}
          {catalog?.limited === true && <p className={css.limitedNotice}>{t('importLimited')}</p>}
          {catalog !== undefined && catalog.items.length === 0 && (
            <p className={css.emptyNotice}>{t('importEmpty')}</p>
          )}

          {catalog !== undefined && catalog.items.length > 0 && (
            <>
              <div className={css.importerToolbar}>
                <div className={css.searchBox}>
                  <Input
                    icon={<IconSearchOutlineRegular size={14} />}
                    value={query}
                    onChange={(event) => { setQuery(event.target.value) }}
                    placeholder={t('importSearch')}
                    aria-label={t('importSearch')}
                  />
                </div>

                <div className={css.filterPills}>
                  <Pill
                    active={sourceFilter === 'all'}
                    aria-pressed={sourceFilter === 'all'}
                    onClick={() => { setSourceFilter('all') }}
                  >
                    {t('filterAll')} ({stats.total})
                  </Pill>
                  {stats.claude > 0 && (
                    <Pill
                      active={sourceFilter === 'claude'}
                      aria-pressed={sourceFilter === 'claude'}
                      onClick={() => { setSourceFilter('claude') }}
                    >
                      {t('sourceClaude')} ({stats.claude})
                    </Pill>
                  )}
                  {stats.codex > 0 && (
                    <Pill
                      active={sourceFilter === 'codex'}
                      aria-pressed={sourceFilter === 'codex'}
                      onClick={() => { setSourceFilter('codex') }}
                    >
                      {t('sourceCodex')} ({stats.codex})
                    </Pill>
                  )}
                </div>

                <div className={css.statusPills}>
                  <Pill
                    active={statusFilter === 'all'}
                    aria-pressed={statusFilter === 'all'}
                    onClick={() => { setStatusFilter('all') }}
                  >
                    {t('filterAll')}
                  </Pill>
                  <Pill
                    active={statusFilter === 'valid'}
                    aria-pressed={statusFilter === 'valid'}
                    onClick={() => { setStatusFilter('valid') }}
                  >
                    {t('filterValid')} ({stats.valid})
                  </Pill>
                  {stats.err > 0 && (
                    <Pill
                      active={statusFilter === 'error'}
                      aria-pressed={statusFilter === 'error'}
                      onClick={() => { setStatusFilter('error') }}
                    >
                      {t('filterErrors')} ({stats.err})
                    </Pill>
                  )}
                </div>

                <div className={css.selectionQuickActions}>
                  <Button size="sm" onClick={selectAllValid} disabled={busy || filteredItems.length === 0}>
                    {t('selectAllValid')}
                  </Button>
                  {selected.length > 0 && (
                    <Button size="sm" onClick={deselectAll} disabled={busy}>
                      {t('deselectAll')}
                    </Button>
                  )}
                </div>
              </div>

              <div className={css.importerList}>
                {filteredItems.length === 0 ? (
                  <div className={css.noMatches}>{t('noMatches')}</div>
                ) : (
                  filteredItems.map((chat) => {
                    const isChecked = selected.includes(chat.key)
                    const isClaude = chat.source.toLowerCase() === 'claude'
                    return (
                      <div
                        key={chat.key}
                        className={clsx(
                          css.importRow,
                          isChecked && css.importRowSelected,
                          chat.error !== undefined && css.importRowError,
                        )}
                      >
                        <div className={css.importRowHeader}>
                          <Checkbox
                            label={`${chat.source}: ${chat.title}`}
                            checked={isChecked}
                            disabled={busy || chat.error !== undefined}
                            onChange={(checked) => {
                              setSelected(keys => checked ? [...keys, chat.key] : keys.filter(k => k !== chat.key))
                            }}
                          />
                          <div className={css.importBadges}>
                            <span className={clsx(css.sourceBadge, isClaude ? css.sourceClaude : css.sourceCodex)}>
                              {chat.source}
                            </span>
                            <span className={css.messageBadge}>
                              {t('messages', { n: chat.messageCount })}
                            </span>
                            <span className={css.dateBadge}>
                              {new Date(chat.updatedAt).toLocaleDateString()}
                            </span>
                          </div>
                        </div>

                        <div className={css.importCwdRow}>
                          <IconFolderOutlineRegular className={css.folderIcon} />
                          <span className={css.cwdText} title={chat.cwd}>{chat.cwd}</span>
                        </div>

                        {chat.error !== undefined ? (
                          <div className={css.importErrorBanner} role="alert">
                            {chat.error}
                          </div>
                        ) : (
                          <details className={css.previewDetails}>
                            <summary>{t('preview')}</summary>
                            <pre className={css.preview}>{chat.preview}</pre>
                          </details>
                        )}
                      </div>
                    )
                  })
                )}
              </div>
            </>
          )}

          {result?.items && result.items.length > 0 && (
            <div className={css.importResultsSection}>
              {result.items.map((item) => {
                const chat = catalog?.items.find(c => c.key === item.key)
                const title = chat?.title ?? item.key
                const isSuccess = item.error === undefined
                return (
                  <p
                    key={item.key}
                    className={clsx(css.resultRow, isSuccess ? css.resultSuccess : css.resultError)}
                    role={isSuccess ? 'status' : 'alert'}
                  >
                    {title}: {item.error ?? t(item.duplicate === true ? 'alreadyImported' : 'imported')}
                    {item.sessionId !== undefined && (
                      <Button size="sm" onClick={() => { if (item.sessionId !== undefined) open(item.sessionId) }}>
                        {t('open')}
                      </Button>
                    )}
                  </p>
                )
              })}
            </div>
          )}

          <div className={css.importerFooter}>
            <div className={css.footerStats}>
              {selected.length > 0 && (
                <span className={css.selectedCountBadge}>
                  {t('selectedCount', { n: selected.length })}
                </span>
              )}
            </div>
            <div className={css.actions}>
              <Button
                size="sm"
                disabled={busy || selected.length === 0}
                onClick={() => { void submit() }}
              >
                {t('importSelected')}
              </Button>
              <Button size="sm" disabled={busy} onClick={() => { setIsVisible(false) }}>
                {t('close')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

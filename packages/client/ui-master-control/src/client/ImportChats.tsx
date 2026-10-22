import { useState } from 'react'
import { Button, Checkbox } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ExternalChatCatalog, ExternalChatImportValue, ExternalChatKey } from '@deepseek-ai/dsh-api-session-controller/client'
import type { MasterControlPageProps } from './MasterControlPage.tsx'
import css from './MasterControlPage.module.css'

export function ImportChats({ discover, importChats, open, t }: Pick<MasterControlPageProps, 'discover' | 'importChats' | 'open' | 't'>) {
  const [catalog, setCatalog] = useState<ExternalChatCatalog>()
  const [selected, setSelected] = useState<ExternalChatKey[]>([])
  const [result, setResult] = useState<ExternalChatImportValue>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [visible, setVisible] = useState(false)
  const load = async () => {
    setVisible(true)
    setCatalog(undefined)
    setBusy(true)
    setError(undefined)
    setSelected([])
    setResult(undefined)
    try { setCatalog(await discover()) } catch (failure) { setError(String(failure)) }
    finally { setBusy(false) }
  }
  const submit = async () => {
    setBusy(true)
    setError(undefined)
    try { setResult(await importChats(selected)); setSelected([]) } catch (failure) { setError(String(failure)) }
    finally { setBusy(false) }
  }
  return (
    <section>
      <Button size="sm" disabled={busy} onClick={() => { void load() }}>{t('importChats')}</Button>
      {visible && <div className={css.importer} aria-busy={busy}>
        <p>{t('importHelp')}</p>
        {busy && <p role="status">{t('working')}</p>}
        {error !== undefined && <p role="alert">{error}</p>}
        {catalog?.limited === true && <p>{t('importLimited')}</p>}
        {catalog?.items.length === 0 && <p>{t('importEmpty')}</p>}
        {catalog?.items.map(chat => <div key={chat.key} className={css.importRow}>
          <Checkbox label={`${chat.source}: ${chat.title}`} checked={selected.includes(chat.key)} disabled={busy || chat.error !== undefined}
            onChange={(checked) => { setSelected(keys => checked ? [...keys, chat.key] : keys.filter(key => key !== chat.key)) }} />
          <p className={css.cwd}>{chat.cwd} · {new Date(chat.updatedAt).toLocaleString()} · {t('messages', { n: chat.messageCount })}</p>
          {chat.error !== undefined ? <p role="alert">{chat.error}</p> : <details><summary>{t('preview')}</summary><pre className={css.preview}>{chat.preview}</pre></details>}
        </div>)}
        {result?.items.map(item => <p key={item.key} role={item.error === undefined ? 'status' : 'alert'}>
          {catalog?.items.find(chat => chat.key === item.key)?.title}: {item.error ?? t(item.duplicate === true ? 'alreadyImported' : 'imported')}
          {item.sessionId !== undefined && <Button size="sm" onClick={() => { if (item.sessionId !== undefined) open(item.sessionId) }}>{t('open')}</Button>}
        </p>)}
        <div className={css.actions}>
          <Button size="sm" disabled={busy || selected.length === 0} onClick={() => { void submit() }}>{t('importSelected')}</Button>
          <Button size="sm" disabled={busy} onClick={() => { setVisible(false) }}>{t('close')}</Button>
        </div>
      </div>}
    </section>
  )
}

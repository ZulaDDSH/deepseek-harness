import { useEffect, useState, type ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { McpServerCandidate, McpServerConfig, McpServerRow } from '@deepseek-ai/dsh-plugin-manager/types'
import { Button, StateDot, Switch, Tag, type StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './McpServersSection.module.css'

export interface McpServersSectionInjected {
  listMcpServers: () => Promise<McpServerRow[]>
  discoverMcpServers: () => Promise<McpServerCandidate[]>
  addMcpServer: (config: McpServerConfig) => Promise<void>
  removeMcpServer: (entryId: string) => Promise<void>
  setMcpServerEnabled: (entryId: string, enabled: boolean) => Promise<void>
}

export type McpServersSectionProps = PropsRuntime<'settings.section'>
  & PropsLocale<'pluginManager'>
  & InjectFace<McpServersSectionInjected>

function splitArgs(text: string): string[] {
  return [...text.matchAll(/"([^"]*)"|(\S+)/g)].map(match => match[1] ?? match[2] ?? '')
}

function parseEnv(text: string): Record<string, string> {
  return Object.fromEntries(text.split(/\r?\n/).map(line => line.trim()).filter(line => line.includes('='))
    .map(line => [line.slice(0, line.indexOf('=')).trim(), line.slice(line.indexOf('=') + 1).trim()]))
}

function stateOf(server: McpServerRow): StateDotState {
  if (!server.enabled) return 'idle'
  if (server.phase === 'active') return 'done'
  if (server.phase === 'failed') return 'error'
  return 'ongoing'
}

export function McpServersSection(props: McpServersSectionProps) {
  const { t } = props
  const [servers, setServers] = useState<McpServerRow[]>()
  const [candidates, setCandidates] = useState<McpServerCandidate[]>()
  const [failure, setFailure] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [revision, setRevision] = useState(0)
  const [draft, setDraft] = useState({ name: '', transport: 'stdio' as McpServerConfig['transport'], command: '', args: '', env: '', url: '' })
  useEffect(() => {
    let current = true
    void props.listMcpServers().then(
      (rows) => { if (current) setServers(rows) },
      (error: unknown) => { if (current) setFailure(String(error)) },
    )
    return () => { current = false }
  }, [props.listMcpServers, revision])
  const run = (operation: () => Promise<void>): void => {
    setBusy(true)
    setFailure(undefined)
    void operation()
      .catch((error: unknown) => { setFailure(error instanceof Error ? error.message : String(error)) })
      .finally(() => {
        setBusy(false)
        setCandidates(undefined)
        setRevision(value => value + 1)
      })
  }
  const add = (): void => {
    const config: McpServerConfig = draft.transport === 'stdio'
      ? { transport: 'stdio', serverName: draft.name.trim(), command: draft.command.trim(), args: splitArgs(draft.args), env: parseEnv(draft.env) }
      : { transport: 'streamable-http', serverName: draft.name.trim(), url: draft.url.trim(), headers: {} }
    run(async () => {
      await props.addMcpServer(config)
      setDraft({ name: '', transport: 'stdio', command: '', args: '', env: '', url: '' })
    })
  }
  const canAdd = draft.name.trim().length > 0 && (draft.transport === 'stdio' ? draft.command.trim().length > 0 : draft.url.trim().length > 0)
  const sourceLabel = (source: McpServerCandidate['source']): string =>
    t(source === 'claude-desktop' ? 'mcpSourceClaudeDesktop' : source === 'claude-code' ? 'mcpSourceClaudeCode' : 'mcpSourceCodex')
  const phaseLabel = (server: McpServerRow): string => {
    if (!server.enabled) return t('mcpOff')
    if (server.phase === 'active') return t('mcpRunning')
    if (server.phase === 'failed') return t('mcpFailedState')
    return server.phase ?? t('mcpStopped')
  }
  const field = (label: Parameters<typeof t>[0], control: ReactNode): ReactNode =>
    <label className={css.field}><span className={css.fieldLabel}>{t(label)}</span>{control}</label>
  return <section className={css.section}>
    <h2 className={css.title}>{t('mcpTitle')}</h2>
    <p className={css.intro}>{t('mcpHelp')}</p>
    {failure === undefined ? null : <p className={css.error} role="alert">{t('mcpFailed')}: {failure}</p>}

    <div className={css.groupHead}><h3 className={css.groupTitle}>{t('mcpYourServers')}</h3></div>
    <div className={css.card}>
      {servers === undefined
        ? <p className={css.empty}>{t('mcpLoading')}</p>
        : servers.length === 0
          ? <p className={css.empty}>{t('mcpEmpty')}</p>
          : <ul className={css.rows}>{servers.map(server => <li key={server.entryId} className={css.row}>
            <StateDot state={stateOf(server)} />
            <div className={css.identity}>
              <span className={css.nameLine}>
                <span className={css.name}>{server.serverName}</span>
                <Tag>{server.transport === 'streamable-http' ? 'HTTP' : 'stdio'}</Tag>
              </span>
              <span className={css.detail} title={server.target}>{phaseLabel(server)} · {server.target}</span>
            </div>
            <span className={css.actions}>
              {server.removable
                ? <Button variant="ghost" disabled={busy} onClick={() => { run(() => props.removeMcpServer(server.entryId)) }}>
                  {t('mcpRemove')}
                </Button>
                : null}
              <Switch
                checked={server.enabled}
                disabled={busy}
                label={`${t('mcpToggle')}: ${server.serverName}`}
                onChange={(enabled) => { run(() => props.setMcpServerEnabled(server.entryId, enabled)) }}
              />
            </span>
          </li>)}</ul>}
    </div>

    <div className={css.groupHead}>
      <h3 className={css.groupTitle}>{t('mcpImportTitle')}</h3>
      <span className={css.groupAction}>
        <Button variant="outline" disabled={busy} onClick={() => {
          setFailure(undefined)
          void props.discoverMcpServers().then(setCandidates, (error: unknown) => { setFailure(String(error)) })
        }}>{t('mcpImportFind')}</Button>
      </span>
    </div>
    {candidates === undefined ? null : <div className={css.card}>
      {candidates.length === 0
        ? <p className={css.empty}>{t('mcpImportNone')}</p>
        : <ul className={css.rows}>{candidates.map(candidate => <li key={`${candidate.source}/${candidate.config.serverName}`} className={css.row}>
          <div className={css.identity}>
            <span className={css.nameLine}>
              <span className={css.name}>{candidate.config.serverName}</span>
              <Tag>{sourceLabel(candidate.source)}</Tag>
            </span>
            <span className={css.detail}>
              {candidate.config.transport === 'stdio' ? [candidate.config.command, ...candidate.config.args].join(' ') : candidate.config.url}
            </span>
          </div>
          <span className={css.actions}>
            {candidate.configured
              ? <Tag>{t('mcpImported')}</Tag>
              : <Button variant="outline" disabled={busy} onClick={() => { run(() => props.addMcpServer(candidate.config)) }}>
                {t('mcpImport')}
              </Button>}
          </span>
        </li>)}</ul>}
    </div>}

    <div className={css.groupHead}><h3 className={css.groupTitle}>{t('mcpAddTitle')}</h3></div>
    <form className={`${css.card} ${css.form}`} onSubmit={(event) => { event.preventDefault(); if (canAdd) add() }}>
      <div className={css.formRow}>
        {field('mcpName', <input className={css.input} aria-label={t('mcpName')} value={draft.name}
          onChange={(event) => { setDraft({ ...draft, name: event.target.value }) }} />)}
        {field('mcpTransport', <select className={`${css.input} ${css.select}`} aria-label={t('mcpTransport')} value={draft.transport}
          onChange={(event) => { setDraft({ ...draft, transport: event.target.value as McpServerConfig['transport'] }) }}>
          <option value="stdio">{t('mcpTransportStdio')}</option>
          <option value="streamable-http">{t('mcpTransportHttp')}</option>
        </select>)}
      </div>
      {draft.transport === 'stdio'
        ? <>
          {field('mcpCommand', <input className={css.input} aria-label={t('mcpCommand')} placeholder="node" value={draft.command}
            onChange={(event) => { setDraft({ ...draft, command: event.target.value }) }} />)}
          {field('mcpArgs', <input className={css.input} aria-label={t('mcpArgs')} placeholder="server.js --flag" value={draft.args}
            onChange={(event) => { setDraft({ ...draft, args: event.target.value }) }} />)}
          {field('mcpEnv', <textarea className={`${css.input} ${css.textarea}`} aria-label={t('mcpEnv')} placeholder={t('mcpEnvPlaceholder')}
            value={draft.env} onChange={(event) => { setDraft({ ...draft, env: event.target.value }) }} />)}
        </>
        : field('mcpUrl', <input className={css.input} aria-label={t('mcpUrl')} placeholder="https://" value={draft.url}
          onChange={(event) => { setDraft({ ...draft, url: event.target.value }) }} />)}
      <div className={css.formActions}>
        <Button variant="primary" type="submit" disabled={busy || !canAdd}>{t('mcpAdd')}</Button>
      </div>
    </form>
  </section>
}

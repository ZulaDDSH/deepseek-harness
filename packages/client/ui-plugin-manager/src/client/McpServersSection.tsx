import { useEffect, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { McpServerCandidate, McpServerConfig, McpServerRow } from '@deepseek-ai/dsh-plugin-manager/types'
import { Button, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
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
  return <section className={css.section}>
    <h2>{t('mcpTitle')}</h2>
    <p>{t('mcpHelp')}</p>
    {failure === undefined ? null : <p role="alert">{t('mcpFailed')}: {failure}</p>}
    {servers === undefined ? <p>{t('mcpLoading')}</p> : servers.length === 0 ? <p>{t('mcpEmpty')}</p> : <ul>
      {servers.map(server => <li key={server.entryId} title={server.target}>
        <Switch
          checked={server.enabled}
          disabled={busy}
          label={`${t('mcpToggle')}: ${server.serverName}`}
          onChange={(enabled) => { run(() => props.setMcpServerEnabled(server.entryId, enabled)) }}
        />
        {' '}<strong>{server.serverName}</strong> <small>{server.transport} · {server.phase ?? t('mcpStopped')}</small>
        {server.removable
          ? <>{' '}<Button variant="outline" disabled={busy} onClick={() => { run(() => props.removeMcpServer(server.entryId)) }}>{t('mcpRemove')}</Button></>
          : null}
      </li>)}
    </ul>}
    <h3>{t('mcpImportTitle')}</h3>
    <Button variant="outline" disabled={busy} onClick={() => {
      setFailure(undefined)
      void props.discoverMcpServers().then(setCandidates, (error: unknown) => { setFailure(String(error)) })
    }}>{t('mcpImportFind')}</Button>
    {candidates === undefined ? null : candidates.length === 0 ? <p>{t('mcpImportNone')}</p> : <ul>
      {candidates.map(candidate => <li key={`${candidate.source}/${candidate.config.serverName}`}
        title={candidate.config.transport === 'stdio' ? [candidate.config.command, ...candidate.config.args].join(' ') : candidate.config.url}>
        <strong>{candidate.config.serverName}</strong> <small>{t(candidate.source === 'claude-desktop' ? 'mcpSourceClaudeDesktop' : candidate.source === 'claude-code' ? 'mcpSourceClaudeCode' : 'mcpSourceCodex')}</small>
        {' '}{candidate.configured
          ? <small>{t('mcpImported')}</small>
          : <Button variant="outline" disabled={busy} onClick={() => { run(() => props.addMcpServer(candidate.config)) }}>{t('mcpImport')}</Button>}
      </li>)}
    </ul>}
    <h3>{t('mcpAddTitle')}</h3>
    <form onSubmit={(event) => { event.preventDefault(); if (canAdd) add() }}>
      <p><input aria-label={t('mcpName')} placeholder={t('mcpName')} value={draft.name} onChange={(event) => { setDraft({ ...draft, name: event.target.value }) }} />
        {' '}<select aria-label={t('mcpTransport')} value={draft.transport}
          onChange={(event) => { setDraft({ ...draft, transport: event.target.value as McpServerConfig['transport'] }) }}>
          <option value="stdio">{t('mcpTransportStdio')}</option>
          <option value="streamable-http">{t('mcpTransportHttp')}</option>
        </select></p>
      {draft.transport === 'stdio' ? <>
        <p><input aria-label={t('mcpCommand')} placeholder={t('mcpCommand')} value={draft.command} onChange={(event) => { setDraft({ ...draft, command: event.target.value }) }} /></p>
        <p><input aria-label={t('mcpArgs')} placeholder={t('mcpArgs')} value={draft.args} onChange={(event) => { setDraft({ ...draft, args: event.target.value }) }} /></p>
        <p><textarea aria-label={t('mcpEnv')} placeholder={t('mcpEnvPlaceholder')} value={draft.env} onChange={(event) => { setDraft({ ...draft, env: event.target.value }) }} /></p>
      </> : <p><input aria-label={t('mcpUrl')} placeholder="https://" value={draft.url} onChange={(event) => { setDraft({ ...draft, url: event.target.value }) }} /></p>}
      <Button type="submit" disabled={busy || !canAdd}>{t('mcpAdd')}</Button>
    </form>
  </section>
}

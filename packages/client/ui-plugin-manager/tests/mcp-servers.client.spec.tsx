// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { act } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import assert from 'node:assert/strict'
import type { McpServerRow } from '@deepseek-ai/dsh-plugin-manager/types'
import { McpServersSection, type McpServersSectionInjected, type McpServersSectionProps } from '../src/client/McpServersSection.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t = ((key: keyof typeof en, params: Record<string, string> = {}) =>
  en[key].replace(/\{(\w+)\}/g, (_match, name: string) => params[name] ?? '')) as McpServersSectionProps['t']

function mount(overrides: Partial<McpServersSectionInjected> = {}) {
  const face: McpServersSectionInjected = {
    listMcpServers: vi.fn(async () => [
      { entryId: 'include/mcp-obs', patchId: 'mcp-obs', serverName: 'obs', transport: 'stdio', target: 'npx obs-mcp', enabled: true, phase: 'active', removable: true },
      { entryId: 'include/memory', serverName: 'memorix', transport: 'stdio', target: 'node m.js', enabled: false, phase: null, removable: false },
      { entryId: 'include/mcp-web', serverName: 'web', transport: 'streamable-http', target: 'https://w', enabled: true, phase: 'failed', removable: true },
      { entryId: 'include/mcp-slow', serverName: 'slow', transport: 'stdio', target: 'slow', enabled: true, phase: 'loading', removable: true },
      { entryId: 'include/mcp-gone', serverName: 'gone', transport: 'stdio', target: 'gone', enabled: true, phase: null, removable: true },
    ]),
    discoverMcpServers: vi.fn(async () => [
      { source: 'claude-desktop' as const, configured: true, config: { transport: 'stdio' as const, serverName: 'obs', command: 'npx', args: [], env: {} } },
      { source: 'claude-code' as const, configured: false, config: { transport: 'streamable-http' as const, serverName: 'web', url: 'https://x', headers: {} } },
      { source: 'codex' as const, configured: false, config: { transport: 'stdio' as const, serverName: 're', command: 'node', args: [], env: {} } },
    ]),
    addMcpServer: vi.fn(async () => {}),
    removeMcpServer: vi.fn(async () => {}),
    setMcpServerEnabled: vi.fn(async () => {}),
    signInMcpServer: vi.fn(async () => {}),
    ...overrides,
  }
  render(<McpServersSection {...{ t, ...face } as McpServersSectionProps} />)
  return face
}

it('lists, toggles, removes, imports and adds MCP servers', async () => {
  const face = mount()
  expect(await screen.findByText('obs')).toBeTruthy()
  expect(screen.getByText(`${en.mcpOff} · node m.js`)).toBeTruthy()
  expect(screen.getByText(`${en.mcpRunning} · npx obs-mcp`)).toBeTruthy()
  expect(screen.getByText(`${en.mcpFailedState} · https://w`)).toBeTruthy()
  expect(screen.getByText('loading · slow')).toBeTruthy()
  expect(screen.getByText(`${en.mcpStopped} · gone`)).toBeTruthy()
  fireEvent.click(screen.getByRole('switch', { name: `${en.mcpToggle}: obs` }))
  await waitFor(() => { expect(face.setMcpServerEnabled).toHaveBeenCalledWith('include/mcp-obs', false) })
  fireEvent.click((await screen.findAllByRole('button', { name: en.mcpRemove }))[0]!)
  await waitFor(() => { expect(face.removeMcpServer).toHaveBeenCalledWith('include/mcp-obs') })

  fireEvent.click(screen.getByRole('button', { name: en.mcpImportFind }))
  expect(await screen.findByText(en.mcpImported)).toBeTruthy()
  expect(screen.getByText(en.mcpSourceClaudeCode)).toBeTruthy()
  expect(screen.getByText(en.mcpSourceCodex)).toBeTruthy()
  fireEvent.click(screen.getAllByRole('button', { name: en.mcpImport })[0]!)
  await waitFor(() => { expect(face.addMcpServer).toHaveBeenCalledWith(expect.objectContaining({ serverName: 'web' })) })

  const add = () => screen.getByRole('button', { name: en.mcpAdd })
  await waitFor(() => { expect((add() as HTMLButtonElement).disabled).toBe(true) })
  fireEvent.change(screen.getByRole('textbox', { name: en.mcpName }), { target: { value: 'tool' } })
  fireEvent.change(screen.getByRole('textbox', { name: en.mcpCommand }), { target: { value: 'node' } })
  fireEvent.change(screen.getByRole('textbox', { name: en.mcpArgs }), { target: { value: 'server.js "a b"' } })
  fireEvent.change(screen.getByRole('textbox', { name: en.mcpEnv }), { target: { value: 'KEY=value\nignored' } })
  fireEvent.click(add())
  await waitFor(() => {
    expect(face.addMcpServer).toHaveBeenLastCalledWith({ transport: 'stdio', serverName: 'tool', command: 'node', args: ['server.js', 'a b'], env: { KEY: 'value' } })
  })
  fireEvent.change(screen.getByRole('textbox', { name: en.mcpName }), { target: { value: 'remote' } })
  fireEvent.change(screen.getByRole('combobox', { name: en.mcpTransport }), { target: { value: 'streamable-http' } })
  fireEvent.change(screen.getByRole('textbox', { name: en.mcpUrl }), { target: { value: 'https://mcp.test' } })
  fireEvent.click(add())
  await waitFor(() => {
    expect(face.addMcpServer).toHaveBeenLastCalledWith({ transport: 'streamable-http', serverName: 'remote', url: 'https://mcp.test', headers: {} })
  })
})

it('ignores reads that settle after unmount and refuses an incomplete submit', async () => {
  let settle: (rows: McpServerRow[]) => void = () => {}
  let fail: (error: Error) => void = () => {}
  const first = mount({ listMcpServers: vi.fn(() => new Promise<McpServerRow[]>((resolve) => { settle = resolve })) })
  cleanup()
  settle([])
  const second = mount({ listMcpServers: vi.fn(() => new Promise<McpServerRow[]>((_, reject) => { fail = reject })) })
  cleanup()
  fail(new Error('late'))
  await Promise.resolve()
  expect(first.listMcpServers).toHaveBeenCalledOnce()
  expect(second.listMcpServers).toHaveBeenCalledOnce()
  const face = mount()
  const form = screen.getByRole('button', { name: en.mcpAdd }).closest('form')
  assert(form !== null)
  fireEvent.submit(form)
  expect(face.addMcpServer).not.toHaveBeenCalled()
})

it('reports failed reads', async () => {
  mount({
    listMcpServers: vi.fn(async () => { throw new Error('list down') }),
    discoverMcpServers: vi.fn(async () => { throw new Error('scan down') }),
  })
  expect(await screen.findByText(`${en.mcpFailed}: list down`)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: en.mcpImportFind }))
  expect(await screen.findByText(`${en.mcpFailed}: scan down`)).toBeTruthy()
})

it('reports empty lists and failed changes', async () => {
  mount({
    listMcpServers: vi.fn(async () => []),
    discoverMcpServers: vi.fn(async () => []),
    addMcpServer: vi.fn(async () => { throw new Error('ambiguous-install') }),
  })
  expect(await screen.findByText(en.mcpEmpty)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: en.mcpImportFind }))
  expect(await screen.findByText(en.mcpImportNone)).toBeTruthy()
  fireEvent.change(screen.getByRole('textbox', { name: en.mcpName }), { target: { value: 'x' } })
  fireEvent.change(screen.getByRole('textbox', { name: en.mcpCommand }), { target: { value: 'node' } })
  fireEvent.click(screen.getByRole('button', { name: en.mcpAdd }))
  expect(await screen.findByText(`${en.mcpFailed}: ambiguous-install`)).toBeTruthy()
})

function refused<T>(reason: string): Promise<T> {
  const settled = Promise.withResolvers<T>()
  settled.reject(reason)
  return settled.promise
}

it('shows a rejection that is not an Error', async () => {
  mount({
    listMcpServers: vi.fn(() => refused<McpServerRow[]>('list refused')),
    discoverMcpServers: vi.fn(() => refused<never[]>('scan refused')),
    addMcpServer: vi.fn(() => refused<undefined>('add refused')),
  })
  expect(await screen.findByText(`${en.mcpFailed}: list refused`)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: en.mcpImportFind }))
  expect(await screen.findByText(`${en.mcpFailed}: scan refused`)).toBeTruthy()
  fireEvent.change(screen.getByRole('textbox', { name: en.mcpName }), { target: { value: 'x' } })
  fireEvent.change(screen.getByRole('textbox', { name: en.mcpCommand }), { target: { value: 'node' } })
  fireEvent.click(screen.getByRole('button', { name: en.mcpAdd }))
  expect(await screen.findByText(`${en.mcpFailed}: add refused`)).toBeTruthy()
})

function row(name: string, connection: NonNullable<McpServerRow['connection']>, extra: Partial<McpServerRow> = {}): McpServerRow {
  return { entryId: `include/mcp-${name}`, serverName: name, transport: 'streamable-http', target: `https://${name}`, enabled: true, phase: 'active', removable: false, connection, ...extra }
}

const authRow = () => row('forge', { state: 'auth-required', toolCount: 0, authKey: 'mcp:forge' })

it('labels each connection state truthfully', async () => {
  mount({ listMcpServers: vi.fn(async () => [
    row('one', { state: 'connected', toolCount: 1 }),
    row('many', { state: 'connected', toolCount: 3 }),
    row('auth', { state: 'auth-required', toolCount: 0 }),
    row('bad', { state: 'failed', toolCount: 0, error: 'refused' }),
    row('blank', { state: 'failed', toolCount: 0 }),
    row('off', { state: 'connected', toolCount: 2 }, { enabled: false }),
  ]) })
  expect(await screen.findByText(`${en.mcpConnectedOne} · https://one`)).toBeTruthy()
  expect(screen.getByText(`${en.mcpConnectedMany.replace('{count}', '3')} · https://many`)).toBeTruthy()
  expect(screen.getByText(`${en.mcpAuthRequired} · https://auth`)).toBeTruthy()
  expect(screen.getByText(`${en.mcpConnectionFailed.replace('{error}', 'refused')} · https://bad`)).toBeTruthy()
  expect(screen.getByTitle(/^Connection failed: +· https:\/\/blank$/)).toBeTruthy()
  expect(screen.getByText(`${en.mcpOff} · https://off`)).toBeTruthy()
  expect(screen.queryByRole('button', { name: en.mcpSignIn })).toBeNull()
})

it('polls while a server is still connecting and stops once it settles', async () => {
  vi.useFakeTimers()
  try {
    const list = vi.fn<McpServersSectionInjected['listMcpServers']>()
      .mockResolvedValueOnce([row('slow', { state: 'connecting', toolCount: 0 })])
      .mockResolvedValue([row('slow', { state: 'connected', toolCount: 2 })])
    mount({ listMcpServers: list })
    await act(async () => { await Promise.resolve() })
    expect(screen.getByText(`${en.mcpConnecting} · https://slow`)).toBeTruthy()
    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
    expect(screen.getByText(`${en.mcpConnectedMany.replace('{count}', '2')} · https://slow`)).toBeTruthy()
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(list).toHaveBeenCalledTimes(2)
  } finally {
    vi.useRealTimers()
  }
})

it('keeps a settled status current, showing a later loss of sign-in without user action', async () => {
  vi.useFakeTimers()
  try {
    const list = vi.fn<McpServersSectionInjected['listMcpServers']>()
      .mockResolvedValueOnce([row('forge', { state: 'connected', toolCount: 2 })])
      .mockResolvedValue([authRow()])
    mount({ listMcpServers: list })
    await act(async () => { await Promise.resolve() })
    expect(screen.getByText(`${en.mcpConnectedMany.replace('{count}', '2')} · https://forge`)).toBeTruthy()
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
    expect(screen.getByText(`${en.mcpAuthRequired} · https://forge`)).toBeTruthy()
    expect(screen.getByRole('button', { name: en.mcpSignIn })).toBeTruthy()
  } finally {
    vi.useRealTimers()
  }
})

it('signs in, shows notices with a link, and refreshes afterwards', async () => {
  const finish = Promise.withResolvers<undefined>()
  const signInMcpServer = vi.fn<McpServersSectionInjected['signInMcpServer']>(async (_key, onNotice) => {
    onNotice({ message: 'Open the page', url: 'https://auth.test/login' })
    onNotice({ message: 'Waiting' })
    await finish.promise
  })
  const list = vi.fn(async () => [authRow(), row('other', { state: 'auth-required', toolCount: 0, authKey: 'mcp:other' })])
  mount({ listMcpServers: list, signInMcpServer })
  fireEvent.click((await screen.findAllByRole('button', { name: en.mcpSignIn }))[0]!)
  expect(signInMcpServer).toHaveBeenCalledWith('mcp:forge', expect.any(Function), expect.any(AbortSignal))
  expect(await screen.findByText('Waiting')).toBeTruthy()
  expect(screen.getByRole('link', { name: en.mcpSignInOpenPage }).getAttribute('href')).toBe('https://auth.test/login')
  expect(screen.getByRole('button', { name: en.mcpSignIn }).hasAttribute('disabled')).toBe(true)
  const reads = list.mock.calls.length
  finish.resolve(undefined)
  await waitFor(() => { expect(screen.queryByRole('button', { name: en.mcpSignInCancel })).toBeNull() })
  await waitFor(() => { expect(list.mock.calls.length).toBeGreaterThan(reads) })
  expect(screen.queryByText('Waiting')).toBeNull()
})

it('cancels a sign-in and reports a failed one', async () => {
  let seen: AbortSignal | undefined
  const signInMcpServer = vi.fn<McpServersSectionInjected['signInMcpServer']>((_key, _onNotice, signal) => {
    seen = signal
    return new Promise((resolve) => { signal.addEventListener('abort', () => { resolve() }) })
  })
  mount({ listMcpServers: vi.fn(async () => [authRow()]), signInMcpServer })
  fireEvent.click(await screen.findByRole('button', { name: en.mcpSignIn }))
  fireEvent.click(await screen.findByRole('button', { name: en.mcpSignInCancel }))
  expect(seen?.aborted).toBe(true)
  expect(await screen.findByRole('button', { name: en.mcpSignIn })).toBeTruthy()
  signInMcpServer.mockRejectedValueOnce(new Error('denied'))
  fireEvent.click(screen.getByRole('button', { name: en.mcpSignIn }))
  expect(await screen.findByText(`${en.mcpFailed}: denied`)).toBeTruthy()
})

it('ignores notices that arrive after a sign-in settled', async () => {
  let late: ((notice: { message: string }) => void) | undefined
  mount({
    listMcpServers: vi.fn(async () => [authRow()]),
    signInMcpServer: vi.fn<McpServersSectionInjected['signInMcpServer']>(async (_key, onNotice) => { late = onNotice }),
  })
  fireEvent.click(await screen.findByRole('button', { name: en.mcpSignIn }))
  await waitFor(() => { expect(screen.queryByRole('button', { name: en.mcpSignInCancel })).toBeNull() })
  act(() => { late?.({ message: 'too late' }) })
  expect(screen.queryByText('too late')).toBeNull()
})

it('aborts a running sign-in on unmount', async () => {
  let seen: AbortSignal | undefined
  mount({
    listMcpServers: vi.fn(async () => [authRow()]),
    signInMcpServer: vi.fn<McpServersSectionInjected['signInMcpServer']>((_key, _onNotice, signal) => { seen = signal; return new Promise<void>(() => {}) }),
  })
  fireEvent.click(await screen.findByRole('button', { name: en.mcpSignIn }))
  expect(seen?.aborted).toBe(false)
  cleanup()
  expect(seen?.aborted).toBe(true)
})

it('parses header lines for an HTTP server', async () => {
  const face = mount()
  fireEvent.change(screen.getByRole('textbox', { name: en.mcpName }), { target: { value: 'forge' } })
  fireEvent.change(screen.getByRole('combobox', { name: en.mcpTransport }), { target: { value: 'streamable-http' } })
  fireEvent.change(screen.getByRole('textbox', { name: en.mcpUrl }), { target: { value: ' https://mcp.test/mcp ' } })
  fireEvent.change(screen.getByRole('textbox', { name: en.mcpHeaders }), {
    target: { value: ['Authorization: Bearer a:b', 'no colon', ': empty', ' X-Team : core '].join(String.fromCharCode(13, 10)) },
  })
  fireEvent.click(screen.getByRole('button', { name: en.mcpAdd }))
  await waitFor(() => {
    expect(face.addMcpServer).toHaveBeenLastCalledWith({
      transport: 'streamable-http', serverName: 'forge', url: 'https://mcp.test/mcp', headers: { 'Authorization': 'Bearer a:b', 'X-Team': 'core' },
    })
  })
})

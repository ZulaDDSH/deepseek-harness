// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { McpServersSection, type McpServersSectionInjected, type McpServersSectionProps } from '../src/client/McpServersSection.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t = ((key: keyof typeof en) => en[key]) as McpServersSectionProps['t']

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
    ...overrides,
  }
  render(<McpServersSection {...{ t, ...face } as unknown as McpServersSectionProps} />)
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

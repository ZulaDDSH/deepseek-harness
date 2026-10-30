// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { MemoryPage } from '../src/client/MemoryPage.tsx'
import type {} from '../src/client/index.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const unusedStandardHook = (): never => { throw new Error('Memory fixture does not provide global state') }
const standard = {
  usePanelInfo: unusedStandardHook, useWorkspaces: unusedStandardHook, useSessions: unusedStandardHook,
  useSessionStatus: unusedStandardHook, useSessionRetainInfo: unusedStandardHook, useResource: unusedStandardHook,
  useRemoteAccess: unusedStandardHook, useSessionAccess: unusedStandardHook, useContextMenu: unusedStandardHook,
  useWorkspaceAccess: unusedStandardHook,
}

it('renders provider records and embeds the official Graphify viewer in a script-only sandbox', async () => {
  const memory: ComponentProps<typeof MemoryPage>['memory'] = {
    inventory: () => Promise.resolve({ ok: true, value: [{ name: 'observations', columns: ['title'], count: 1 }] }),
    page: () => Promise.resolve({ ok: true, value: { table: 'observations', columns: ['title'],
      rows: [{ title: 'Saved guide', projectId: 'project-a', narrative: 'Complete guide text' }], total: 1, offset: 0, limit: 50 } }),
    graph: () => Promise.resolve({ ok: true, value: { path: 'graphify-out/graph.json', html: '<html>Official Graphify communities</html>', documents: 1 } }),
    importDocument: () => Promise.resolve({ ok: true, value: { filename: 'guide.md', originalPath: 'documents/guide.md',
      completed: 1, total: 1, error: null } }),
    status: () => Promise.reject(new Error('The chat memory status is not part of this fixture')),
    retry: () => Promise.reject(new Error('The chat memory status is not part of this fixture')),
  }
  const t = ((key: keyof typeof en) => en[key]) as ComponentProps<typeof MemoryPage>['t']
  const { container } = render(<MemoryPage {...standard} memory={memory} t={t} />)
  fireEvent.click(await screen.findByRole('button', { name: /Saved guide/ }))
  expect(screen.getByText(/Complete guide text/)).toBeTruthy()
  expect(container.textContent).toMatchSnapshot('memory browser')
  fireEvent.click(screen.getByRole('tab', { name: 'Context graph' }))
  await waitFor(() => { expect(container.querySelector('iframe')).not.toBeNull() })
  const frame = container.querySelector('iframe')!
  expect(frame.getAttribute('srcdoc')).toBe('<html>Official Graphify communities</html>')
  expect(frame.getAttribute('sandbox')).toBe('allow-scripts')
  expect(container.querySelector('svg')).toBeNull()
  expect(container.textContent).toMatchSnapshot('memory graph')

})

it('keeps a completed upload visible and refreshes records when the next document fails', async () => {
  let reads = 0
  const memory: ComponentProps<typeof MemoryPage>['memory'] = {
    inventory: () => Promise.resolve({ ok: true, value: [{ name: 'observations', columns: [], count: 0 }] }),
    page: () => {
      reads++
      return Promise.resolve({ ok: true, value: { table: 'observations', columns: [], rows: [], total: 0, offset: 0, limit: 50 } })
    },
    graph: () => Promise.resolve({ ok: true, value: { path: '', html: '', documents: 1 } }),
    importDocument: filename => filename === 'bad.pdf'
      ? Promise.reject(new Error('Invalid PDF'))
      : Promise.resolve({ ok: true, value: { filename, originalPath: 'documents/guide.md', completed: 1, total: 1, error: null } }),
    status: () => Promise.reject(new Error('The chat memory status is not part of this fixture')),
    retry: () => Promise.reject(new Error('The chat memory status is not part of this fixture')),
  }
  const t = ((key: keyof typeof en) => en[key]) as ComponentProps<typeof MemoryPage>['t']
  const { container } = render(<MemoryPage {...standard} memory={memory} t={t} />)
  await screen.findByText('No records')
  const files = ['guide.md', 'bad.pdf'].map((name) => {
    const file = new File(['guide'], name)
    Object.defineProperty(file, 'arrayBuffer', { value: () => Promise.resolve(new TextEncoder().encode('guide').buffer) })
    return file
  })
  const input = container.querySelector('input[type="file"]')
  expect(input).not.toBeNull()
  fireEvent.change(input!, { target: { files } })
  await screen.findByRole('alert')
  expect(screen.getByText(/guide.md: Document chunks saved 1\/1/)).toBeTruthy()
  await waitFor(() => { expect(reads).toBeGreaterThan(1) })
  expect(screen.getByRole('alert').textContent).toBe('Invalid PDF')
})

type Memory = ComponentProps<typeof MemoryPage>['memory']
const translate = ((key: keyof typeof en) => en[key]) as ComponentProps<typeof MemoryPage>['t']
const emptyPage = { table: 'observations', columns: [], rows: [], total: 0, offset: 0, limit: 4 }

function memoryWith(overrides: Partial<Memory> = {}): Memory {
  return {
    inventory: () => Promise.resolve({ ok: true, value: [{ name: 'observations', columns: [], count: 0 }] }),
    page: () => Promise.resolve({ ok: true, value: emptyPage }),
    graph: () => Promise.resolve({ ok: true, value: { path: 'graph.json', html: '<html></html>', documents: 1 } }),
    importDocument: () => Promise.resolve({ ok: true, value: { filename: 'a.md', originalPath: 'a.md', completed: 1, total: 1, error: null } }),
    status: () => Promise.resolve({ ok: true, value: { chatMemory: true, server: 'ready' } }),
    retry: () => Promise.resolve({ ok: true, value: { chatMemory: true, server: 'ready' } }),
    ...overrides,
  }
}

const mount = (memory: Memory) => render(<MemoryPage {...standard} memory={memory} t={translate} />)
const idle = () => waitFor(() => { expect(screen.getByRole<HTMLButtonElement>('button', { name: en.refresh }).disabled).toBe(false) })

function refused<T>(reason: string): Promise<T> {
  const settled = Promise.withResolvers<T>()
  settled.reject(reason)
  return settled.promise
}

function fileNamed(name: string): File {
  const file = new File(['guide'], name)
  Object.defineProperty(file, 'arrayBuffer', { value: () => Promise.resolve(new TextEncoder().encode('guide').buffer) })
  return file
}

it('labels every record shape and pages through a table', async () => {
  const head = [
    { title: { base64: 'AQL/' }, status: 'open' },
    { name: 'named', originProjectId: 'origin', state: 'ready' },
    { id: 7, project_id: 'snake', type: null },
    {},
  ]
  const page = vi.fn((table: string, offset: number, _query: string, _view: string) => Promise.resolve({ ok: true as const, value: {
    table, columns: [], rows: offset === 0 ? head : [{ title: 'tail' }], total: 5, offset, limit: 4 } }))
  const inventory = vi.fn(() => Promise.resolve({ ok: true as const, value: [
    { name: 'observations', columns: [], count: 5 }, { name: 'other', columns: [], count: 0 }] }))
  mount(memoryWith({ inventory, page }))
  await screen.findByRole('button', { name: /named.*origin · ready/ })
  expect(screen.getByText('{"base64":"AQL/"}')).toBeTruthy()
  expect(screen.getByRole('button', { name: /^7.*snake/ })).toBeTruthy()
  expect(screen.getByRole('button', { name: '4' })).toBeTruthy()

  await idle()
  fireEvent.click(screen.getByRole('button', { name: en.next }))
  await screen.findByRole('button', { name: /tail/ })
  expect(page).toHaveBeenLastCalledWith('observations', 4, '', 'all')
  await idle()
  expect(screen.getByRole<HTMLButtonElement>('button', { name: en.next }).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: en.previous }))
  await screen.findByRole('button', { name: /named.*origin · ready/ })
  expect(page).toHaveBeenLastCalledWith('observations', 0, '', 'all')

  await idle()
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'other' } })
  await waitFor(() => { expect(page).toHaveBeenLastCalledWith('other', 0, '', 'all') })
  await idle()
  fireEvent.change(screen.getByRole('textbox', { name: en.search }), { target: { value: 'abc' } })
  await waitFor(() => { expect(page).toHaveBeenLastCalledWith('other', 0, 'abc', 'all') })
  await idle()
  const reads = inventory.mock.calls.length
  fireEvent.click(screen.getByRole('button', { name: en.refresh }))
  await waitFor(() => { expect(inventory.mock.calls.length).toBeGreaterThan(reads) })

  await idle()
  fireEvent.click(screen.getByRole('tab', { name: en.graph }))
  await screen.findByTitle(en.graph)
  fireEvent.click(screen.getByRole('tab', { name: en.browse }))
  expect(await screen.findByText(en.allScope)).toBeTruthy()
})

it('shows Host refusals and rejected calls as readable messages', async () => {
  mount(memoryWith({ inventory: () => Promise.resolve({ ok: false, error: new Error('Memorix is not connected') } as never) }))
  expect((await screen.findByRole('alert')).textContent).toBe('Memorix is not connected')
  cleanup()
  mount(memoryWith({ page: () => refused<never>('plain failure') }))
  expect((await screen.findByRole('alert')).textContent).toBe('plain failure')
})

it('ignores results that arrive after the page unmounts', async () => {
  const pending = Promise.withResolvers<Awaited<ReturnType<Memory['inventory']>>>()
  mount(memoryWith({ inventory: () => pending.promise })).unmount()
  await act(async () => { pending.resolve({ ok: true, value: [] }) })

  const failing = Promise.withResolvers<Awaited<ReturnType<Memory['inventory']>>>()
  mount(memoryWith({ inventory: () => failing.promise })).unmount()
  await act(async () => { failing.reject(new Error('late failure')) })

  const graph = Promise.withResolvers<Awaited<ReturnType<Memory['graph']>>>()
  const view = mount(memoryWith({ graph: () => graph.promise }))
  await idle()
  fireEvent.click(screen.getByRole('tab', { name: en.graph }))
  view.unmount()
  await act(async () => { graph.resolve({ ok: true, value: { path: 'p', html: '', documents: 1 } }) })
  expect(screen.queryByRole('alert')).toBeNull()
})

it('reports a rejected upload without refreshing and ignores an empty file selection', async () => {
  const page = vi.fn(() => Promise.resolve({ ok: true as const, value: emptyPage }))
  const importDocument = vi.fn(() => refused<never>('upload refused'))
  const { container } = mount(memoryWith({ page, importDocument }))
  await idle()
  const input = container.querySelector('input[type="file"]')!
  fireEvent.change(input, { target: { files: null } })
  expect(importDocument).not.toHaveBeenCalled()
  fireEvent.change(input, { target: { files: [fileNamed('a.md')] } })
  expect((await screen.findByRole('alert')).textContent).toBe('upload refused')
  expect(page).toHaveBeenCalledTimes(1)
})

const recordPage = (rows: Record<string, unknown>[], total = rows.length) => (table: string, offset: number) => Promise.resolve({
  ok: true as const, value: { table, columns: ['title', 'topicKey'], rows, total, offset, limit: 50 } as never })
const topicInventory = () => Promise.resolve({ ok: true as const, value: [
  { name: 'sessions', columns: ['id'], count: 1 },
  { name: 'observations', columns: ['title', 'topicKey'], count: 2 }] })

it('opens on the memory tables first and applies the typed search once after a pause', async () => {
  const page = vi.fn(recordPage([{ title: 'Alpha' }]))
  mount(memoryWith({ inventory: topicInventory, page }))
  await screen.findByRole('button', { name: /Alpha/ })
  expect(screen.getByRole<HTMLSelectElement>('combobox').value).toBe('observations')
  expect(Array.from(screen.getByRole('combobox').querySelectorAll('option')).map(option => option.value)).toEqual(['observations', 'sessions'])
  await idle()
  const input = screen.getByRole('textbox', { name: en.search })
  const before = page.mock.calls.length
  for (const value of ['s', 'sn', 'snake']) fireEvent.change(input, { target: { value } })
  expect(page.mock.calls.length).toBe(before)
  await waitFor(() => { expect(page).toHaveBeenLastCalledWith('observations', 0, 'snake', 'all') })
  expect(page.mock.calls.length).toBe(before + 1)
})

it('applies the search immediately on Enter and says when nothing matches', async () => {
  const page = vi.fn((table: string, offset: number, query: string) =>
    recordPage(query === '' ? [{ title: 'Alpha' }] : [])(table, offset))
  mount(memoryWith({ inventory: topicInventory, page }))
  await screen.findByRole('button', { name: /Alpha/ })
  await idle()
  const input = screen.getByRole('textbox', { name: en.search })
  fireEvent.change(input, { target: { value: 'zzz' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(await screen.findByText(/No records match/)).toBeTruthy()
  expect(page).toHaveBeenLastCalledWith('observations', 0, 'zzz', 'all')
})

it('filters saved memories from imported documents and shows the visible range', async () => {
  const page = vi.fn((table: string, offset: number, _query: string, view: string) =>
    recordPage(view === 'documents' ? [{ title: 'Doc chunk' }] : [{ title: 'Alpha' }, { title: 'Beta' }], 9)(table, offset))
  mount(memoryWith({ inventory: topicInventory, page }))
  await screen.findByRole('button', { name: /Beta/ })
  expect(screen.getByText('1–2 of 9')).toBeTruthy()
  await idle()
  fireEvent.click(screen.getByRole('button', { name: en.viewDocuments }))
  await screen.findByRole('button', { name: /Doc chunk/ })
  expect(page).toHaveBeenLastCalledWith('observations', 0, '', 'documents')
  expect(screen.getByRole('button', { name: en.viewDocuments }).getAttribute('aria-pressed')).toBe('true')
})

it('hides the view filter on tables without a topic key', async () => {
  mount(memoryWith({ page: recordPage([{ title: 'Alpha' }]) }))
  await screen.findByRole('button', { name: /Alpha/ })
  expect(screen.queryByRole('button', { name: en.viewDocuments })).toBeNull()
})

it('lists every field of the selected record and keeps multi-line text', async () => {
  mount(memoryWith({ inventory: topicInventory, page: recordPage([{ title: 'Alpha', narrative: 'line one\nline two', facts: ['a', 'b'] }]) }))
  expect(screen.getByText(en.loading)).toBeTruthy()
  fireEvent.click(await screen.findByRole('button', { name: /Alpha/ }))
  const row = screen.getByText(en['field.narrative']).parentElement!
  expect(row.querySelector('dd')!.textContent).toBe('line one\nline two')
  expect(screen.getAllByRole('listitem').map(item => item.textContent)).toEqual(['a', 'b'])
  expect(screen.getByRole('button', { name: /Alpha/ }).getAttribute('aria-current')).toBe('true')
})

it('tells the user what to configure when Memorix is unavailable', async () => {
  const message = 'No MCP client named memorix is mounted'
  mount(memoryWith({ inventory: () => Promise.resolve({ ok: false, error: new Error(message) } as never) }))
  expect((await screen.findByRole('alert')).textContent).toBe(message)
  expect(screen.getByText(en.setupHint)).toBeTruthy()
  expect(screen.queryByText(en.empty)).toBeNull()
  expect(screen.queryByRole('combobox')).toBeNull()
})

it('shows the chat memory state, the failure, the retry action and the latest save failure when Memorix is unavailable', async () => {
  const retry = vi.fn(() => Promise.resolve({ ok: true as const, value: { chatMemory: true, server: 'starting' as const } }))
  mount(memoryWith({
    status: () => Promise.resolve({ ok: true, value: {
      chatMemory: true,
      server: 'unavailable',
      connection: 'Memorix is not connected: the MCP client "memorix" is failed (Connection closed).',
      saveFailure: { message: 'server is disconnected', at: '2026-10-15T09:00:00.000Z' },
    } }),
    retry,
  }))
  expect(await screen.findByText(en.chatOn)).toBeTruthy()
  expect(screen.getByText(`${en.unavailable}: Memorix is not connected: the MCP client "memorix" is failed (Connection closed).`)).toBeTruthy()
  expect(screen.getByText(en.unavailableHint)).toBeTruthy()
  expect(screen.getByText(`${en.saveFailed} (${en.at} 2026-10-15T09:00:00.000Z): server is disconnected`)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: en.retry }))
  await screen.findByText(en.settingUp)
  expect(retry).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('button', { name: en.retry })).toBeNull()
})

it('shows Setting up while Memorix starts and Ready once it is connected', async () => {
  const states: Array<'starting' | 'ready'> = ['starting', 'ready']
  mount(memoryWith({
    status: () => Promise.resolve({ ok: true, value: { chatMemory: true, server: states.length > 1 ? states.shift()! : 'ready' } }),
  }))
  expect(await screen.findByText(en.settingUp)).toBeTruthy()
  expect(await screen.findByText(en.ready, {}, { timeout: 4000 })).toBeTruthy()
  expect(screen.queryByRole('button', { name: en.retry })).toBeNull()
})

it('keeps the graph tab free of the missing-graph hint while Graphify builds and when it fails', async () => {
  const graph = Promise.withResolvers<Awaited<ReturnType<Memory['graph']>>>()
  mount(memoryWith({ graph: () => graph.promise }))
  await idle()
  fireEvent.click(screen.getByRole('tab', { name: en.graph }))
  expect(await screen.findByText(en.graphBuilding)).toBeTruthy()
  expect(screen.queryByText(en.graphMissing)).toBeNull()
  await act(async () => { graph.resolve({ ok: false, error: new Error('Graphify could not start') } as never) })
  expect((await screen.findByRole('alert')).textContent).toBe('Graphify could not start')
  expect(screen.queryByText(en.graphMissing)).toBeNull()
})

it('shows the setup hint only when Memorix itself is unavailable', async () => {
  mount(memoryWith({ graph: () => Promise.resolve({ ok: false, error: new Error('Graphify could not start') } as never) }))
  await idle()
  fireEvent.click(screen.getByRole('tab', { name: en.graph }))
  expect((await screen.findByRole('alert')).textContent).toBe('Graphify could not start')
  expect(screen.queryByText(en.setupHint)).toBeNull()
})

it('shows the upload hint instead of an empty viewer when no document is imported', async () => {
  mount(memoryWith({ graph: () => Promise.resolve({ ok: true, value: { path: 'g.json', html: '', documents: 0 } }) }))
  await idle()
  fireEvent.click(screen.getByRole('tab', { name: en.graph }))
  expect(await screen.findByText(en.graphMissing)).toBeTruthy()
  expect(document.querySelector('iframe')).toBeNull()
})

it('imports documents dropped onto the upload zone through the same handler', async () => {
  const importDocument = vi.fn((filename: string) => Promise.resolve({ ok: true as const,
    value: { filename, originalPath: filename, completed: 1, total: 1, error: null } }))
  const { container } = mount(memoryWith({ importDocument }))
  await idle()
  const zone = container.querySelector('input[type="file"]')!.closest('label')!
  fireEvent.drop(zone, { dataTransfer: { files: [fileNamed('drop.md')] } })
  expect(await screen.findByText(/drop.md: Document chunks saved 1\/1/)).toBeTruthy()
  expect(importDocument).toHaveBeenCalledTimes(1)
  expect(importDocument.mock.calls[0]?.[0]).toBe('drop.md')
})

it('labels fields readably, lists JSON-string arrays and formats instants', async () => {
  mount(memoryWith({ inventory: topicInventory, page: recordPage([{
    title: 'Alpha', entityName: 'Widget', someOtherKey: 'x', facts: '["one","two"]', concepts: '[1,2]', createdAt: '2026-10-15T09:30:00.000Z',
  }]) }))
  fireEvent.click(await screen.findByRole('button', { name: /Alpha/ }))
  expect(screen.getByText(en['field.entityName'])).toBeTruthy()
  expect(screen.getByText('Some other key')).toBeTruthy()
  expect(screen.queryByText('entityName')).toBeNull()
  expect(screen.getAllByRole('listitem').map(item => item.textContent)).toEqual(['one', 'two'])
  expect(screen.getByText('[1,2]')).toBeTruthy()
  const created = screen.getByText(en['field.createdAt']).parentElement!.querySelector('dd')!.textContent
  expect(created).toBe(new Intl.DateTimeFormat(en.dateLocale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date('2026-10-15T09:30:00.000Z')))
})

it('names the collection select distinctly from the Browse tab', async () => {
  mount(memoryWith({ inventory: topicInventory }))
  expect((await screen.findByRole('combobox')).getAttribute('aria-label')).toBe(en.collection)
})

it('formats the last saved and recalled instants and keeps Not yet', async () => {
  mount(memoryWith({ status: () => Promise.resolve({ ok: true, value: {
    chatMemory: true, server: 'ready', lastSavedAt: '2026-10-15T09:30:00.000Z',
  } }) }))
  const format = new Intl.DateTimeFormat(en.dateLocale, { dateStyle: 'medium', timeStyle: 'short' })
  expect(await screen.findByText(format.format(new Date('2026-10-15T09:30:00.000Z')))).toBeTruthy()
  expect(screen.getByText(en.never)).toBeTruthy()
})

it('ignores dropped files while busy', async () => {
  const importDocument = vi.fn(() => refused<never>('nope'))
  const { container } = mount(memoryWith({ importDocument }))
  const zone = container.querySelector('label')!
  fireEvent.drop(zone, { dataTransfer: { files: [new File(['x'], 'a.txt')] } })
  expect(importDocument).not.toHaveBeenCalled()
  await screen.findByRole('combobox')
})

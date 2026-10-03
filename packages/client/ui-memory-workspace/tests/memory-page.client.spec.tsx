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
}

it('renders provider records and embeds the official Graphify viewer in a script-only sandbox', async () => {
  const memory: ComponentProps<typeof MemoryPage>['memory'] = {
    inventory: () => Promise.resolve({ ok: true, value: [{ name: 'observations', columns: ['title'], count: 1 }] }),
    page: () => Promise.resolve({ ok: true, value: { table: 'observations', columns: ['title'],
      rows: [{ title: 'Saved guide', projectId: 'project-a', narrative: 'Complete guide text' }], total: 1, offset: 0, limit: 50 } }),
    graph: () => Promise.resolve({ ok: true, value: { path: 'graphify-out/graph.json', html: '<html>Official Graphify communities</html>' } }),
    importDocument: () => Promise.resolve({ ok: true, value: { filename: 'guide.md', originalPath: 'documents/guide.md',
      completed: 1, total: 1, error: null } }),
  }
  const t = ((key: keyof typeof en) => en[key]) as ComponentProps<typeof MemoryPage>['t']
  const { container } = render(<MemoryPage {...standard} memory={memory} t={t} />)
  fireEvent.click(await screen.findByRole('button', { name: /Saved guide/ }))
  expect(screen.getByText(/Complete guide text/)).toBeTruthy()
  expect(container.textContent).toMatchSnapshot('memory browser')
  fireEvent.click(screen.getByRole('button', { name: 'Context graph' }))
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
    graph: () => Promise.resolve({ ok: true, value: { path: '', html: '' } }),
    importDocument: filename => filename === 'bad.pdf'
      ? Promise.reject(new Error('Invalid PDF'))
      : Promise.resolve({ ok: true, value: { filename, originalPath: 'documents/guide.md', completed: 1, total: 1, error: null } }),
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
})

type Memory = ComponentProps<typeof MemoryPage>['memory']
const translate = ((key: keyof typeof en) => en[key]) as ComponentProps<typeof MemoryPage>['t']
const emptyPage = { table: 'observations', columns: [], rows: [], total: 0, offset: 0, limit: 4 }

function memoryWith(overrides: Partial<Memory> = {}): Memory {
  return {
    inventory: () => Promise.resolve({ ok: true, value: [{ name: 'observations', columns: [], count: 0 }] }),
    page: () => Promise.resolve({ ok: true, value: emptyPage }),
    graph: () => Promise.resolve({ ok: true, value: { path: 'graph.json', html: '<html></html>' } }),
    importDocument: () => Promise.resolve({ ok: true, value: { filename: 'a.md', originalPath: 'a.md', completed: 1, total: 1, error: null } }),
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
  const page = vi.fn((table: string, offset: number) => Promise.resolve({ ok: true as const, value: {
    table, columns: [], rows: offset === 0 ? head : [{ title: 'tail' }], total: 5, offset, limit: 4 } }))
  const inventory = vi.fn(() => Promise.resolve({ ok: true as const, value: [
    { name: 'observations', columns: [], count: 5 }, { name: 'other', columns: [], count: 0 }] }))
  mount(memoryWith({ inventory, page }))
  await screen.findByRole('button', { name: /namedoriginready/ })
  expect(screen.getByText('{"base64":"AQL/"}')).toBeTruthy()
  expect(screen.getByRole('button', { name: '7snake' })).toBeTruthy()
  expect(screen.getByRole('button', { name: '4' })).toBeTruthy()

  await idle()
  fireEvent.click(screen.getByRole('button', { name: en.next }))
  await screen.findByRole('button', { name: /tail/ })
  expect(page).toHaveBeenLastCalledWith('observations', 4, '')
  await idle()
  expect(screen.getByRole<HTMLButtonElement>('button', { name: en.next }).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: en.previous }))
  await screen.findByRole('button', { name: /namedoriginready/ })
  expect(page).toHaveBeenLastCalledWith('observations', 0, '')

  await idle()
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'other' } })
  await waitFor(() => { expect(page).toHaveBeenLastCalledWith('other', 0, '') })
  await idle()
  fireEvent.change(screen.getByRole('textbox', { name: en.search }), { target: { value: 'abc' } })
  await waitFor(() => { expect(page).toHaveBeenLastCalledWith('other', 0, 'abc') })
  await idle()
  const reads = inventory.mock.calls.length
  fireEvent.click(screen.getByRole('button', { name: en.refresh }))
  await waitFor(() => { expect(inventory.mock.calls.length).toBeGreaterThan(reads) })

  await idle()
  fireEvent.click(screen.getByRole('button', { name: en.graph }))
  await screen.findByTitle(en.graph)
  fireEvent.click(screen.getByRole('button', { name: en.browse }))
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
  fireEvent.click(screen.getByRole('button', { name: en.graph }))
  view.unmount()
  await act(async () => { graph.resolve({ ok: true, value: { path: 'p', html: '' } }) })
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

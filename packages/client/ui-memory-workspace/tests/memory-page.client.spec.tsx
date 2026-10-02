// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

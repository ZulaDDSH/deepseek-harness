import { describe, expect, it } from 'vitest'
import { resolve } from 'node:path'
import { WorkspaceTypertGenerator } from '../src/workspace.ts'
import { executableRemoteModule } from './remote-module.ts'

const repositoryRoot = resolve(import.meta.dirname, '../../../..')
const PACKAGE = '@deepseek-ai/dsh-client-ui-memory-workspace'
const IMPORT_DOCUMENT = `${PACKAGE}#memoryWorkspace/importDocument`

interface RuntimeDescriptor {
  readonly id: string
  readonly cancellation?: { readonly parameter: 'signal' }
}

interface RuntimeRemoteModule {
  readonly TYPERT_REMOTE: { readonly descriptors: readonly RuntimeDescriptor[] }
}

describe('Memory workspace generated Typert descriptors', { timeout: 180_000 }, () => {
  it('marks importDocument cancellation-aware on both faces so the Client deadline does not cut long imports', async () => {
    const [artifact] = new WorkspaceTypertGenerator(repositoryRoot).generate([PACKAGE], ['host'])
    const remote = await executableRemoteModule<RuntimeRemoteModule>(artifact?.remote?.js ?? '')
    const descriptor = remote.TYPERT_REMOTE.descriptors.find(candidate => candidate.id === IMPORT_DOCUMENT)
    expect(descriptor?.cancellation).toEqual({ parameter: 'signal' })
    const host = artifact?.js ?? ''
    const start = host.indexOf("    'memoryWorkspace/importDocument': {")
    expect(start).toBeGreaterThanOrEqual(0)
    const end = host.indexOf("\n    '", start + 1)
    expect(host.slice(start, end < 0 ? undefined : end)).toContain("cancellation: { parameter: 'signal' }")
  })
})

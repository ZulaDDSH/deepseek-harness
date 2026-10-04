/**
 * REAL-composition tier (packages/AGENTS.md): boot the knowledge-router Loader
 * fixtures as subprocesses through the same app/boot path a deployment uses,
 * with real MCP stdio servers connected through `dsh-mcp-client`, and assert
 * the assembled model-visible surface — the registered tool, provider
 * connection status, the routing decision, the configured bounds applied to
 * each provider call, and the freshness the packet carries.
 *
 * The second case proves the goal's provider-failure requirement: one provider
 * cannot start, and the harness still boots and answers from the other.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

const driver = fileURLToPath(new URL(
  './fixtures/loader/driver.ts',
  import.meta.url,
))
const configPath = fileURLToPath(new URL(
  './fixtures/loader/cordis.yml',
  import.meta.url,
))
const degradedConfigPath = fileURLToPath(new URL(
  './fixtures/loader/cordis-provider-down.yml',
  import.meta.url,
))
const downConfigPath = fileURLToPath(new URL(
  './fixtures/loader/cordis-both-down.yml',
  import.meta.url,
))
const learningConfigPath = fileURLToPath(new URL(
  './fixtures/loader/cordis-learning.yml',
  import.meta.url,
))
const fixtureServer = fileURLToPath(new URL(
  './fixtures/knowledge-server.ts',
  import.meta.url,
))
const repoTsconfig = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))

const processTimeoutMs = 90_000

interface KnowledgeLoaderReport {
  knowledgeToolRegistered: boolean
  gitnexusConnected: boolean
  graphifyConnected: boolean
  gitnexusTools: string[]
  providers: string[]
  unavailable: string[]
  truncated: boolean
  freshness: string[]
  recordToolRegistered: boolean
  recordIsError: boolean
  text: string
}

/** Boot one composition in its own subprocess and return the driver's report. */
async function smoke(config: string, tempDirPrefix: string): Promise<KnowledgeLoaderReport> {
  let report: KnowledgeLoaderReport | undefined
  const { stderr } = await runLoaderSmoke({
    label: `knowledge-router loader smoke (${tempDirPrefix})`,
    tempDirPrefix,
    binScript: driver,
    libBinScript: driver,
    configPath: config,
    tsconfigPath: repoTsconfig,
    env: { ...process.env, DSH_KNOWLEDGE_FIXTURE: fixtureServer },
    processTimeoutMs,
    inspect: async (cwd) => {
      report = JSON.parse(await readFile(join(cwd, 'knowledge-loader-report.json'), 'utf8')) as KnowledgeLoaderReport
    },
  })
  expect(stderr).not.toContain('UNHANDLED')
  expect(report).toBeDefined()
  return report as KnowledgeLoaderReport
}

describe('knowledge-router through a real Loader composition', () => {
  it('connects both MCP providers, routes the task, and bounds each provider call', async () => {
    const report = await smoke(configPath, 'knowledge-router-loader-')
    expect(report).toMatchObject({
      knowledgeToolRegistered: true,
      gitnexusConnected: true,
      graphifyConnected: true,
      gitnexusTools: ['query', 'query_graph'],
      providers: ['gitnexus', 'graphify'],
      unavailable: [],
      truncated: false,
      freshness: ['gitnexus:unknown', 'graphify:stale'],
      recordToolRegistered: false,
    })
    // The configured bounds reached the provider arguments, and the imperative
    // task with a historical signal routed to both providers.
    expect(report.text).toContain('CODE for "Investigate this recurring race and propose a fix." limit=3 symbols=7')
    expect(report.text).toContain('depth=2 budget=900')
    expect(report.text).toContain('CODE INTELLIGENCE')
    expect(report.text).toContain('LEARNED CONTEXT')
    expect(report.text).toContain('STALE - REVERIFY')
  }, processTimeoutMs + 15_000)

  it('continues with the surviving provider when one provider cannot start', async () => {
    const report = await smoke(degradedConfigPath, 'knowledge-router-down-')
    expect(report).toMatchObject({
      knowledgeToolRegistered: true,
      gitnexusConnected: true,
      graphifyConnected: false,
      providers: ['gitnexus'],
      unavailable: ['graphify'],
      freshness: ['gitnexus:unknown'],
    })
    expect(report.text).toContain('CODE for "Investigate this recurring race and propose a fix." limit=3 symbols=7')
    expect(report.text).toContain('unavailable: graphify')
    expect(report.text).not.toContain('LEARNED CONTEXT')
  }, processTimeoutMs + 15_000)

  it('boots and answers with no provider at all', async () => {
    const report = await smoke(downConfigPath, 'knowledge-router-both-down-')
    expect(report).toMatchObject({
      knowledgeToolRegistered: true,
      gitnexusConnected: false,
      graphifyConnected: false,
      gitnexusTools: [],
      providers: [],
      unavailable: ['gitnexus', 'graphify'],
      freshness: [],
    })
    expect(report.text).toContain('queried: none')
    expect(report.text).toContain('unavailable: gitnexus, graphify')
    expect(report.text).not.toContain('CODE INTELLIGENCE')
  }, processTimeoutMs + 15_000)

  it('registers the write-back tool only when learning is enabled, and fails loudly without the provider', async () => {
    const report = await smoke(learningConfigPath, 'knowledge-router-learning-')
    expect(report).toMatchObject({
      knowledgeToolRegistered: true,
      recordToolRegistered: true,
      recordIsError: true,
    })
  }, processTimeoutMs + 15_000)
})

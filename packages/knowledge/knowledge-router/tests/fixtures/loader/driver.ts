#!/usr/bin/env node
/**
 * Test driver: boot the knowledge-router Loader composition — two real MCP
 * stdio servers through `dsh-mcp-client`, plus the router — then read provider
 * status, dispatch the model-facing knowledge tool, and persist what the model
 * would see to `./knowledge-loader-report.json` for the package spec's inspect
 * step.
 */

import { writeFile } from 'node:fs/promises'
import { boot, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { ToolCallId } from '@deepseek-ai/dsh-llm'

const configPath = process.argv[2]
if (configPath === undefined) throw new Error('knowledge-router driver requires a config path')

const ctx = await boot('knowledge-router-loader-smoke', resolveConfigPath(configPath, undefined))
try {
  const statuses = ctx.knowledge.status()
  const connected = (provider: string): boolean =>
    statuses.find(status => status.provider === provider)?.connected === true

  const result = await ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId('loader-knowledge'),
    name: 'knowledge_query',
    arguments: { task: 'Investigate this recurring race and propose a fix.' },
  })
  const value = result.value as {
    providers: string[]
    unavailable: string[]
    truncated: boolean
    items: { provider: string; freshness: { kind: string }; text: string }[]
  }

  const recordToolRegistered = ctx.tools.get('knowledge_record') !== undefined
  const record = recordToolRegistered
    ? await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('loader-record'),
      name: 'knowledge_record',
      arguments: { question: 'Q', answer: 'A', outcome: 'useful', validated_by: 'reviewer' },
    })
    : undefined

  await writeFile('./knowledge-loader-report.json', JSON.stringify({
    knowledgeToolRegistered: ctx.tools.get('knowledge_query') !== undefined,
    gitnexusConnected: connected('gitnexus'),
    graphifyConnected: connected('graphify'),
    gitnexusTools: statuses.find(status => status.provider === 'gitnexus')?.tools ?? [],
    providers: value.providers,
    unavailable: value.unavailable,
    truncated: value.truncated,
    freshness: value.items.map(item => `${item.provider}:${item.freshness.kind}`),
    recordToolRegistered,
    recordIsError: record?.isError ?? false,
    text: result.content.filter(block => block.type === 'text').map(block => block.text).join(''),
  }))
} finally {
  await ctx.fiber.dispose()
}
